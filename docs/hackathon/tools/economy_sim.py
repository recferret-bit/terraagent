#!/usr/bin/env python3
"""TerraAgent economy & terraforming calculator (design-time, not game code).

Model A: one colony, 1 s steps, scripted build order, ECONOMY_RATE_SCALE 0.25,
20-min day (55 % daylight), per-family storage caps, hex territory (Hub R10),
terraform drones + optional Terraforming Processor, D-34 tier gates, Trade Hub
export caps and a Guild counterparty for the "trader" path.

Model B: one planet, 1-min steps, 7 days, 5 colonies, Guild inventory pricing,
mint caps, fee / treasury / protocol legs.

All numbers come from docs/game/*.md and docs/spec/SIMULATION.md unless marked
PROPOSED (then they are assumptions this calculator makes explicit).
"""
import math, sys, json
from collections import defaultdict

SCALE = 0.25                      # ECONOMY_RATE_SCALE (D-16)
DAY_S = 1200; DAYLIGHT = 0.55     # SIMULATION 7.6 temperate
HEX = lambda r: 3*r*r + 3*r + 1   # tiles in a hex disc of radius r

# ---------- hex helpers ----------
def hex_disc(cx, cy, r):
    s = set()
    for q in range(-r, r+1):
        for rr in range(max(-r, -q-r), min(r, -q+r)+1):
            s.add((cx+q, cy+rr))
    return s

def beacon_gain(hub_r=10, beacon_r=8, d=10):
    """New tiles a T1 beacon adds when placed d tiles from the Hub centre."""
    hub = hex_disc(0, 0, hub_r); b = hex_disc(d, 0, beacon_r)
    return len(b - hub)

# ---------- data rows (T1 unless noted) ----------
# name: (M, Min, Pet, W, build_s, drain, footprint, extra)
B = {
 'hub':        (200,100, 50, 50, 20, 5, 9, {}),
 'solar':      ( 60, 75, 10,  5, 18, 1, 4, {'solar': 21}),
 'wind':       ( 70, 35,  5,  0, 14, 1, 4, {'wind': 16}),
 'thermal':    ( 80, 20, 20, 10, 15, 3, 4, {'gen': 28, 'fuel': 1.5*SCALE}),
 'capacitor':  ( 70, 60, 10, 10, 16, 1.5, 4, {'store': 1500, 'disch': 30}),
 'extractor':  ( 65, 20,  0, 10, 14, 6, 4, {'metals': 4.0*SCALE}),
 'quarry':     ( 75, 30,  5, 15, 16, 8, 4, {'minerals': 3.0*SCALE}),
 'water':      ( 60, 35, 10,  0, 15, 7, 4, {'water': 3.5*SCALE}),
 'petro':      ( 90, 45, 15, 20, 20, 10, 4, {'bio2': 2.5*SCALE}),
 'depot':      ( 60, 25, 10,  0, 12, 2, 4, {'cap': 1000}),
 'dca':        ( 55, 45, 10,  5, 14, 5, 1, {'supply': 8}),
 'factory':    (120, 70, 30, 20, 25, 10, 9, {}),
 'autocannon': ( 55, 20, 10,  0, 12, 3, 1, {}),
 'laser':      ( 50, 55, 15, 10, 16, 8, 1, {}),
 'pylon':      ( 15,  5,  0,  0,  4, 0.5, 1, {}),
 'tradehub':   (100, 80, 30, 10, 22, 6, 4, {'throughput': 250}),
 'beacon':     ( 80, 40,  0, 10, 18, 4, 1, {'claim': 'beacon'}),
 'processor':  (200,180, 80,100, 40, 25, 9, {'proc': True}),
 # deltas for in-place upgrades (T2 items: 60/40 T1/T2 for M and Min, Pet -> bio.t2)
 'hub_t2':     (400,250,150,100, 75, 9, 7, {'tier2': True, 'supply': 15, 'cap': 1000}),
 'extractor_t2':(115, 55, 25, 20, 34, 12, 5, {'tier2': True, 'metals': (12.5-4.0)*SCALE}),
 'quarry_t2':  (135, 65, 30, 30, 38, 14, 5, {'tier2': True, 'minerals': (9.5-3.0)*SCALE}),
 'factory_t2': (220,160, 70, 40, 60, 18, 7, {'tier2': True}),
}
U = {  # name: (M, Min, Pet, W, build_s, drain, supply)
 'harvester':  (40, 15,  5,  0, 10, 1.5, 1),
 'builder':    (45, 25, 10,  0, 12, 2.0, 1),
 'terraformer':(50, 30,  5, 10, 14, 2.5, 1),
 'recon':      (60, 30, 10,  0, 12, 2.0, 1),   # PROPOSED (units spec §5.2 not loaded here)
 'multitask2': (130,90, 30, 15, 26, 5.0, 2),
}
# Terraform ops to Living from each terrain class: (seconds @1.0x, energy, M, Min, water)
# Flat -> Prepared: Grade 3 s / 20 E. Prepared -> Living: Irrigate 10 s/80 E/15 W + Seed 15 s/90 E/10 W + 5 Min
PREP = {'flat':(3,20,0,0,0), 'forest':(8,50,0,0,0), 'rock':(9,80,-10,0,0), 'slope':(11,80,0,2,0),
        'hole':(13,120,10,5,0), 'shallow':(17,220,20,10,0)}
LIVING_EXTRA = (25, 170, 0, 5, 25)
# temperate land mix near a colony (SIMULATION §10 wins over the units spec, R12) PROPOSED split
MIX = {'flat':0.56, 'forest':0.20, 'rock':0.08, 'slope':0.08, 'hole':0.02, 'shallow':0.04, 'deep':0.02}

def living_cost(terrain):
    t,e,m,mi,w = PREP[terrain]; t2,e2,m2,mi2,w2 = LIVING_EXTRA
    return (t+t2, e+e2, m+m2, mi+mi2, w+w2)

# ---------- Model A ----------
class Colony:
    def __init__(self, name='A', terraformers=1, processor_rate=0.5, guild_ratio=None,
                 export=False, hub_r=10, proc_scaled=False, log=None, living_biomass=0.0, clear_yield=5.0, cap_mode='family',
                 kit=(400,250,150,150), cap_store=1500, gate_mode='pct', t2_share=0.4):
        self.name = name
        self.cap_store = cap_store     # Capacitor T1 storage (spec 1 500; proposed 6 000)
        self.gate_mode = gate_mode     # 'pct' (D-34: 30/70 % of owned) or 'count' (PROPOSED: 100/230 Living tiles)
        self.t2_share = t2_share       # share of M and Min a T2 item pays in T2 (D-34: 0.4; proposed 0.25)
        self.cap_mode = cap_mode   # 'family' (D-34 shared cap) or 'sub' (PROPOSED: each sub-resource capped separately)
        self.living_biomass = living_biomass   # PROPOSED: Harvester yield on Living tiles (biomass/s)
        self.clear_yield = clear_yield         # biomass per forest tile cleared (spec: 5)
        self.t = 0
        self.stock = defaultdict(float)
        for k,v in zip(('metals.t1','minerals.t1','bio.biomass','bio.water'), kit):
            self.stock[k] = v
        self.cap = 500
        self.buildings = defaultdict(int)
        self.units = defaultdict(int)
        self.supply_cap = 10
        self.energy_store = 1000.0   # HQ power cell (PROPOSED 1 000 E, recharged by the Founder Core +8 E/s)
        self.surplus = 0.0
        self.owned = HEX(hub_r)
        self.tiles = {k: self.owned*v for k,v in MIX.items()}   # terrain classes among owned
        self.footprint = 0
        self.living = 0.0
        self.prepared_pool = 0.0  # Prepared tiles not under a footprint (Processor feed)
        self.living_progress = 0.0
        self.proc_rate = processor_rate * (SCALE if proc_scaled else 1.0)
        self.guild_ratio = guild_ratio
        self.export = export
        self.exported = defaultdict(float); self.orbit = defaultdict(float)
        self.export_min = defaultdict(float)
        self.bought_t2 = defaultdict(float)
        self.stage = 0; self.stage_t = {0:0}
        self.queue = []          # construction
        self.unit_queue = []
        self.cur = None; self.cur_left = 0; self.cur_prep = 0
        self.ucur = None; self.ucur_left = 0
        self.paused_night = 0
        self.terra_energy = 0; self.terra_water = 0
        self.log = log if log is not None else []
        self.brownout_s = 0
        self.wasted = defaultdict(float)
        self.events = []
        self.terraformers = terraformers

    # --- helpers ---
    def fam(self, key): return key.split('.')[0]
    def fam_total(self, f): return sum(v for k,v in self.stock.items() if k.startswith(f+'.'))
    def add(self, key, amt):
        f = self.fam(key); room = (self.cap - self.fam_total(f)) if self.cap_mode == 'family' else (self.cap - self.stock[key])
        if room <= 0: self.wasted[key] += amt; return
        a = min(amt, room); self.stock[key] += a; self.wasted[key] += amt - a

    def cost_of(self, row, tier2=False):
        M,Mi,Pet,W = row[0],row[1],row[2],row[3]
        if tier2:
            a = self.t2_share
            return {'metals.t1':(1-a)*M,'metals.t2':a*M,'minerals.t1':(1-a)*Mi,'minerals.t2':a*Mi,
                    'bio.t2':Pet,'bio.water':W}
        return {'metals.t1':M,'minerals.t1':Mi,'bio.biomass':Pet,'bio.water':W}
    def can_pay(self, cost): return all(self.stock[k] >= v for k,v in cost.items())
    def pay(self, cost):
        for k,v in cost.items(): self.stock[k] -= v

    def daylight(self):
        x = (self.t % DAY_S) / DAY_S
        if x < DAYLIGHT: return math.sin(math.pi * x / DAYLIGHT)
        return 0.0
    def wind(self):  # smoothed 0.5-1.4, mean ~0.95
        return 0.95 + 0.35*math.sin(self.t/240.0)

    def gen(self):
        g = 8.0  # Founder core (HQ cell) +8 E/s
        g += self.buildings['solar']*21*self.daylight()
        g += self.buildings['wind']*16*self.wind()
        if self.stock['bio.biomass'] > 0: g += self.buildings['thermal']*28
        return g
    def drain(self):
        d = sum(B[b][5]*n for b,n in self.buildings.items())
        d += sum(U[u][5]*n for u,n in self.units.items())*0.5
        if self.buildings['processor']: d += 0  # already in row
        return d

    # --- stages (units spec §6.2 triggers, simplified) ---
    def update_stage(self):
        s = self.stage
        def enter(n):
            self.stage = n; self.stage_t[n] = self.t
        if s == 0 and self.buildings['hub']: enter(1)
        elif s == 1 and self.buildings['extractor'] and (self.buildings['solar'] or self.buildings['wind']): enter(2)
        elif s == 2 and self.t - self.stage_t[2] >= 300: enter(3)
        elif s == 3 and self.buildings['factory'] and self.units['recon'] and self.t - self.stage_t[3] >= 360: enter(4)
        elif s == 4 and self.buildings['hub_t2']: enter(5)
        elif s == 5 and self.buildings['factory_t2'] and self.t - self.stage_t[5] >= 300: enter(6)

    def tf_pct(self):
        denom = self.owned - self.tiles['deep']*0 - 0  # deep water counted until reclaimed? UO-TF-06 excludes unreclaimed deep
        denom = self.owned - self.tiles['deep']
        return 100.0*self.living/denom

    def t2_gate(self): return self.living >= 100 if self.gate_mode == 'count' else self.tf_pct() >= 30
    def t3_gate(self): return self.living >= 230 if self.gate_mode == 'count' else self.tf_pct() >= 70

    # --- one second ---
    def step(self, build_plan):
        t = self.t
        # power first: a brownout (deficit the cell/capacitors cannot cover) sheds group 3 = extractors
        gen, dr = self.gen(), self.drain()
        prod_drain = sum(B[b][5]*self.buildings[b] for b in ('extractor','extractor_t2','quarry','quarry_t2','water','petro','depot','factory','factory_t2','tradehub'))
        net = gen - dr
        store_cap = 1000 + self.buildings['capacitor']*self.cap_store
        disch = 8 + self.buildings['capacitor']*30
        shed = False
        if net >= 0:
            self.surplus = net
        else:
            need = -net; take = min(need, self.energy_store, disch)
            if take >= need - 1e-9:
                self.energy_store -= take; self.surplus = 0
            else:
                # shed groups 2-3 (production, factory, trade hub); defenses, hub, DCA and robots stay on
                shed = True; self.brownout_s += 1
                net2 = gen - (dr - prod_drain)
                if net2 < 0:
                    take2 = min(-net2, self.energy_store, disch); self.energy_store -= take2; self.surplus = 0
                else:
                    self.surplus = net2
        # production (0 while shed)
        P = 0.0 if shed else 1.0
        split = (0.5,0.3,0.2) if self.t3_gate() else ((0.7,0.3,0.0) if self.t2_gate() else (1,0,0))
        m = self.buildings['extractor']*B['extractor'][7]['metals'] + self.buildings['extractor_t2']*B['extractor_t2'][7]['metals']
        mi = self.buildings['quarry']*B['quarry'][7]['minerals'] + self.buildings['quarry_t2']*B['quarry_t2'][7]['minerals']
        m += max(0, self.units['harvester'] - 1)*2.0*SCALE   # 2nd+ Harvester on a surface metals deposit
        m *= P; mi *= P
        # the first Harvester clears forest (+clear_yield biomass per tile, 5 s per tile) or harvests Living ground
        extra = min(1, self.units['harvester'])
        if extra:
            if self.tiles['forest'] > 1:
                self.add('bio.biomass', extra*self.clear_yield/5.0); self.tiles['forest'] -= extra/5.0; self.tiles['flat'] += extra/5.0
            elif self.living_biomass and self.living > 0:
                self.add('bio.biomass', extra*self.living_biomass)
        for k,share in zip(('metals.t1','metals.t2','metals.t3'), split):
            if share: self.add(k, m*share)
        for k,share in zip(('minerals.t1','minerals.t2','minerals.t3'), split):
            if share: self.add(k, mi*share)
        self.add('bio.water', P*self.buildings['water']*B['water'][7]['water'])
        if self.t2_gate(): self.add('bio.t2', P*self.buildings['petro']*B['petro'][7]['bio2'])
        if self.buildings['thermal']:
            self.stock['bio.biomass'] = max(0, self.stock['bio.biomass'] - self.buildings['thermal']*B['thermal'][7]['fuel'])
        # construction
        self.construct(build_plan, self.surplus)
        self.produce_units()
        self.terraform(self.surplus)
        # leftover surplus charges the cell / capacitors
        self.energy_store = min(store_cap, self.energy_store + max(0, self.surplus))
        self.trade()
        self.update_stage()
        self.t += 1

    def take_energy(self, e):
        """Draw e E this second from grid surplus, then from the HQ cell / capacitors. True if paid."""
        if self.surplus >= e: self.surplus -= e; return True
        rest = e - self.surplus
        if self.energy_store >= rest: self.surplus = 0; self.energy_store -= rest; return True
        return False

    def construct(self, plan, surplus):
        if self.cur is None:
            # pick the next plan item whose stage is reached
            for item in plan:
                name, stage = item
                if self.stage >= stage and not getattr(item, 'done', False):
                    row = B[name]; cost = self.cost_of(row, row[7].get('tier2', False))
                    if name == 'hub_t2' and self.t - self.stage_t.get(4, 1e9) < 480: continue
                    # cap check: cost must fit storage
                    if self.can_pay(cost):
                        self.pay(cost); self.cur = item; self.cur_left = row[4]; self.cur_prep = row[6]*3; self.footprint += row[6]
                        break
                    elif row[7].get('tier2'):
                        continue   # a T2 order waits for T2 stock; the player keeps building T1 behind it
                    else:
                        break      # waiting(resources): the lane is in order
        else:
            name = self.cur[0]; row = B[name]
            if self.cur_prep > 0:
                # site prep: Grade 3 s/tile @ 20 E per tile over 3 s (6.7 E/s), by the terraform lane
                if self.take_energy(6.7):
                    self.cur_prep -= 1
                    self.terra_energy += 6.7
                return
            rate = 1.0 + self.units['builder']   # the HQ Commander builds at 1.0x; Builders add 1.0x each
            self.cur_left -= rate
            if self.cur_left <= 0:
                self.buildings[name] += 1; self.cur.done = True
                ex = row[7]
                if 'cap' in ex: self.cap += ex['cap']
                if 'supply' in ex: self.supply_cap += ex['supply']
                if name == 'beacon': self.owned += beacon_gain(); self.tiles = {k: self.owned*v for k,v in MIX.items()}
                if name == 'hub': self.supply_cap = 10
                self.events.append((self.t, 'built', name))
                self.cur = None

    def produce_units(self):
        if self.ucur is None:
            for item in self.unit_queue:
                name, stage = item
                if self.stage >= stage and not getattr(item,'done',False):
                    row = U[name]; cost = self.cost_of(row, name=='multitask2')
                    used = sum(U[u][6]*n for u,n in self.units.items())
                    if used + row[6] > self.supply_cap: break
                    if name in ('recon',) and not self.buildings['factory']: break
                    # construction first: keep enough stock for the next pending structure of this stage
                    nxt = next((B[i[0]] for i in self.plan if not getattr(i,'done',False) and self.stage >= i[1] and self.cur is not i), None)
                    reserve = self.cost_of(nxt, nxt[7].get('tier2', False)) if nxt and not nxt[7].get('tier2') else {}
                    if self.can_pay({k: cost.get(k,0) + reserve.get(k,0) for k in set(cost)|set(reserve)}):
                        self.pay(cost); self.ucur = item; self.ucur_left = row[4]; break
                    else: break
        else:
            self.ucur_left -= 1
            if self.ucur_left <= 0:
                self.units[self.ucur[0]] += 1; self.ucur.done = True
                if self.ucur[0]=='terraformer': self.terraformers += 1
                self.ucur = None

    def terraform(self, surplus):
        """Drones: terrain -> Prepared (prep op) then Prepared -> Living (Irrigate+Seed).
        With a Processor, drones only prep and the Processor converts Prepared -> Living."""
        if self.stage < 4: return
        workers = self.terraformers + self.units['multitask2']*2.0
        if self.cur is not None and self.cur_prep > 0: workers -= 1  # one drone is on site prep
        if workers <= 0: return
        proc = self.buildings['processor'] > 0
        # --- Processor: Prepared -> Living at proc_rate tiles/s, -4 W/s, -25 E/s
        if proc and self.prepared_pool >= self.proc_rate and self.stock['bio.water'] >= 4.0:
            if self.take_energy(25):
                self.stock['bio.water'] -= 4.0; self.terra_water += 4.0; self.terra_energy += 25
                self.prepared_pool -= self.proc_rate; self.living += self.proc_rate
        # --- Drones
        # choose the job: prep if (processor exists) or (no prepared stock); else living on prepared
        do_prep = self.prepared_pool < (30 if proc else 1)   # with a Processor, drones prep until 30 tiles are ahead, then help with Living
        if do_prep:
            for cls in ('flat','forest','rock','slope','hole','shallow'):
                avail = self.tiles[cls] - (self.footprint if cls=='flat' else 0)
                if avail <= 0.5: continue
                secs,E,M,Mi,W = PREP[cls]
                e_ps = E/secs*workers; mi_ps = Mi/secs*workers
                if self.stock['minerals.t1'] < mi_ps: return
                if not self.take_energy(e_ps): self.paused_night += 1; return
                self.stock['minerals.t1'] -= mi_ps
                if M < 0: self.add('metals.t1', -M/secs*workers)
                else: self.stock['metals.t1'] = max(0, self.stock['metals.t1'] - M/secs*workers)
                self.terra_energy += e_ps
                self.prep_progress = getattr(self, 'prep_progress', 0.0) + workers/secs
                if self.prep_progress >= 1:
                    n = int(self.prep_progress); self.prep_progress -= n
                    self.tiles[cls] -= n; self.prepared_pool += n
                    if cls == 'forest': self.add('bio.biomass', n*self.clear_yield)
                return
            return
        # living on prepared tiles: Irrigate 10 s/80 E/15 W + Seed 15 s/90 E/10 W + 5 Min
        secs, E, W, Mi = 25, 170, 25, 5
        e_ps = E/secs*workers; w_ps = W/secs*workers; mi_ps = Mi/secs*workers
        if self.stock['bio.water'] < w_ps or self.stock['minerals.t1'] < mi_ps: return
        if not self.take_energy(e_ps): self.paused_night += 1; return
        self.stock['bio.water'] -= w_ps; self.stock['minerals.t1'] -= mi_ps
        self.terra_energy += e_ps; self.terra_water += w_ps
        self.living_progress += workers/secs
        if self.living_progress >= 1:
            n = int(self.living_progress); self.living_progress -= n
            n = min(n, int(self.prepared_pool))
            self.living += n; self.prepared_pool -= n

    def trade(self):
        """Trader path: export surplus T1 (hub throughput 250/min, 20k/day) and buy T2 from the Guild."""
        if not self.export or not self.buildings['tradehub']: return
        minute = self.t // 60
        for key in ('metals.t1','minerals.t1','bio.water'):
            f = self.fam(key)
            if self.fam_total(f) > 0.8*self.cap:
                amt = min(self.stock[key] - 0.5*self.cap, 250 - self.export_min[minute])
                if amt > 10:
                    self.stock[key] -= amt; self.orbit[key] += amt; self.exported[key] += amt; self.export_min[minute] += amt
        # buy T2 with orbit T1 at ratio R (Guild ask incl. spread)
        if self.guild_ratio and self.stage >= 4:
            need = {'metals.t2':160,'minerals.t2':100,'bio.t2':150}
            for k,v in need.items():
                short = v - self.stock[k] - self.bought_t2.get(k+'_pending',0)
                if short > 0:
                    pay_key = 'metals.t1' if self.orbit['metals.t1'] >= short*self.guild_ratio else None
                    if pay_key is None and self.orbit['minerals.t1'] >= short*self.guild_ratio: pay_key='minerals.t1'
                    if pay_key is None and self.orbit['bio.water'] >= short*self.guild_ratio: pay_key='bio.water'
                    if pay_key:
                        self.orbit[pay_key] -= short*self.guild_ratio; self.stock[k] += short; self.bought_t2[k] += short
                        self.events.append((self.t,'bought',k,short,pay_key))

class Item(list):
    def __init__(self, name, stage): super().__init__((name, stage)); self.done=False

def plan_reference(trader=False, processor=False, beacons=2, extra_terraformers=1):
    """Build order from units spec §6.4, extended through S5."""
    p = [Item('hub',0), Item('solar',1), Item('extractor',1), Item('quarry',1), Item('water',2),
         Item('wind',2), Item('wind',2), Item('wind',2), Item('depot',2), Item('pylon',2), Item('pylon',2), Item('pylon',2),
         Item('solar',2), Item('factory',3), Item('autocannon',3), Item('autocannon',3), Item('dca',3), Item('thermal',3),
         Item('extractor',3)]
    if trader: p.append(Item('tradehub',3))
    p += [Item('beacon',4) for _ in range(beacons)] + [Item('extractor',4), Item('quarry',4), Item('depot',4), Item('water',4), Item('wind',4), Item('capacitor',4), Item('petro',4), Item('water',4), Item('wind',4)]
    p += [Item('hub_t2',4)]
    if processor: p.append(Item('processor',5))
    p += [Item('factory_t2',5), Item('dca',5), Item('extractor_t2',5)]
    u = [Item('harvester',1), Item('builder',2), Item('harvester',2), Item('terraformer',3), Item('recon',3), Item('recon',3)]
    u += [Item('terraformer',4) for _ in range(extra_terraformers)] + [Item('multitask2',5)]
    return p, u

def run_colony(minutes=120, **kw):
    plan, uplan = plan_reference(**{k:v for k,v in kw.items() if k in ('trader','processor','beacons','extra_terraformers')})
    c = Colony(**{k:v for k,v in kw.items() if k in ('terraformers','processor_rate','guild_ratio','export','proc_scaled','living_biomass','clear_yield','cap_mode','kit','cap_store','gate_mode','t2_share')})
    c.terraformers = 1  # the HQ drone works the terraform lane from landing
    c.plan = plan; c.uplan = uplan; c.unit_queue = uplan
    snaps = {}
    for s in range(minutes*60):
        c.step(plan)
        if s % 300 == 0: snaps[s//60] = snapshot(c)
        for th in (30,50,70):
            if c.tf_pct() >= th and not hasattr(c, f'tf{th}'): setattr(c, f'tf{th}', f'{s//60}:{s%60:02d}')
    return c, snaps

def snapshot(c):
    return dict(t=c.t//60, stage=c.stage, tf=round(c.tf_pct(),1), living=int(c.living), owned=c.owned,
                M=int(c.stock['metals.t1']), Mi=int(c.stock['minerals.t1']), W=int(c.stock['bio.water']), Bio=int(c.stock['bio.biomass']),
                M2=int(c.stock['metals.t2']), Mi2=int(c.stock['minerals.t2']), B2=int(c.stock['bio.t2']),
                gen=round(c.gen(),1), drain=round(c.drain(),1), supply=sum(U[u][6]*n for u,n in c.units.items()), scap=c.supply_cap,
                cap=c.cap, brown=c.brownout_s, paused=c.paused_night, tE=int(c.terra_energy), tW=int(c.terra_water),
                exported=int(sum(c.exported.values())), wasted=int(sum(c.wasted.values())))

# ---------- Terraform arithmetic (closed form) ----------
def terraform_table():
    rows = []
    owned = HEX(10); deep = owned*MIX['deep']; denom = owned - deep
    fp = 70  # typical S5 footprint tiles (hub 9 + ~12 buildings x4 + factory 9 + ~6 x1)
    for target in (30, 50, 70, 100):
        need = math.ceil(target/100*denom)
        # cheapest tiles first
        order = ['flat','forest','rock','slope','hole','shallow']
        pool = {k: owned*MIX[k] for k in order}; pool['flat'] -= fp
        left = need; secs=E=W=Mi=M=0; got=0
        for k in order:
            n = min(left, max(0,pool[k]))
            s,e,m,mi,w = living_cost(k)
            secs += n*s; E += n*e; W += n*w; Mi += n*mi; M += n*m; left -= n; got += n
            if left <= 0: break
        rows.append(dict(target=target, need=need, reachable=left<=0, max_pct=round(100*(denom-fp-deep*0)/denom,1),
                         drone_h=round(secs/3600,2), drone1_min=round(secs/60), drone3_min=round(secs/180),
                         E=int(E), W=int(W), Mi=int(Mi), M=int(M)))
    return owned, denom, fp, rows

# ---------- Model B: planet economy, 7 days ----------
def planet_week(k=1.0, guild_drain=0.0, mint_cap=20000, colonies=5, fee_bp=100, protocol_bp=25,
                treasury_share=0.2, p2p_share=0.3, guild_target=2500, guild_cap=5000, npcs=2,
                t2_restock=600, days=7, visits_per_day=34, verbose=False):
    """Aggregate: each colony exports its surplus (capped) and sells to the Guild while the Guild bids.
    guild_drain = share of Guild inventory sold off-planet per Guild visit (PROPOSED sink); visits are spread over
    the 48 half-hour slots (spec schedule: 2 NPCs, 12 min dock + 20-40 min gap = ~34 dockings/day; proposed: ~48).
    t2_restock = T2 units per sub-resource per NPC per day (PROPOSED)."""
    ref = {'metals.t1':1.0,'minerals.t1':1.3,'bio.water':1.1}
    inv = {r: guild_target for r in ref}; inv_t2 = {'metals.t2':t2_restock,'minerals.t2':t2_restock,'bio.t2':t2_restock}
    price = {r: ref[r] for r in ref}; t2_price = {r: 4.0 for r in inv_t2}
    hist = []
    treasury = 0.0; protocol = 0.0; stall_fees = 0.0; vol = 0.0; guild_vol = 0.0
    minted = defaultdict(float); burned_t2 = 0.0
    # colony surplus per day by age (units/day per sub-resource, after spending) PROPOSED profile
    def surplus(day):   # a colony of this age, per T1 sub-resource, per day
        return [6000, 12000, 20000, 25000, 25000, 25000, 25000][min(day,6)]
    acc = 0.0
    for day in range(days):
        for visit in range(48):  # 48 half-hour slots
            acc += visits_per_day/48.0; docked = acc >= 1
            if docked: acc -= 1
            # colonies export (mint) their surplus for the slot
            for r in ref:
                s = colonies * min(surplus(day), mint_cap)/48
                minted[r] += s
                # p2p share trades between players at the stall fee
                p2p = s*p2p_share; vol += p2p
                fee = p2p*fee_bp/10000; stall_fees += fee*(1-treasury_share); treasury += fee*treasury_share
                protocol += p2p*protocol_bp/10000
                # the rest is offered to the Guild bid
                offer = s - p2p
                room = max(0, guild_cap*npcs - inv[r])
                filled = min(offer, room)
                inv[r] += filled; guild_vol += filled
                protocol += filled*protocol_bp/10000
                # pricing: mid = ref * (target/inv)^k, clamped 0.25x..4x
                price[r] = min(4*ref[r], max(0.25*ref[r], ref[r]*(guild_target*npcs/max(1,inv[r]))**k))
                # off-planet sale on docked slots only
                if docked: inv[r] *= (1-guild_drain)
            # T2 demand: each colony past day 1 buys ~200 T2 per slot when it can
            for r in inv_t2:
                want = colonies*(0 if day==0 else 120)/48
                got = min(want, inv_t2[r]); inv_t2[r] -= got; burned_t2 += got
                t2_price[r] = min(16, max(2, 4.0*(t2_restock/max(1,inv_t2[r]))**k))
            for r in inv_t2: inv_t2[r] = min(t2_restock*npcs*2, inv_t2[r] + t2_restock*npcs/48)
            hist.append(dict(day=day, slot=visit, p_m=round(price['metals.t1'],2), inv_m=int(inv['metals.t1']),
                             p_t2=round(t2_price['metals.t2'],2), inv_t2=int(inv_t2['metals.t2'])))
    return dict(treasury=int(treasury), stall_fees=int(stall_fees), protocol=int(protocol), p2p_volume=int(vol),
                guild_volume=int(guild_vol), minted=int(sum(minted.values())), final_price_m=round(price['metals.t1'],2),
                final_inv_m=int(inv['metals.t1']), hist=hist)

def summary(label, c):
    tot = c.t
    return dict(scenario=label, units=' '.join(f'{k}:{v}' for k,v in c.units.items() if v), S3=stamp(c.stage_t.get(3)), S4=stamp(c.stage_t.get(4)), S5=stamp(c.stage_t.get(5)), S6=stamp(c.stage_t.get(6)),
                tf30=getattr(c,'tf30','-'), tf50=getattr(c,'tf50','-'), tf70=getattr(c,'tf70','-'), tf_end=round(c.tf_pct(),1),
                living=int(c.living), water_tf=int(c.terra_water), energy_tf=int(c.terra_energy), brownout_pct=round(100*c.brownout_s/tot,1),
                exported=int(sum(c.exported.values())), wasted=int(sum(c.wasted.values())))
def stamp(sec):
    return '-' if sec is None else f'{sec//60}:{sec%60:02d}'

# ---------- Raid arithmetic (battle v1: plain HP / DPS, one bite per second, focus fire) ----------
DEF = {'autocannon':(55,450,18), 'laser':(50,400,24), 'recon':(60,240,14)}   # metals cost, HP, DPS
def raid_race(defenders, n_skitter, hp=120, dps=8, dt=0.1):
    order = [d for d,k in defenders.items() for _ in range(k)]
    dh = [DEF[d][1] for d in order]; sk = [hp]*n_skitter; t = 0.0
    while sk and dh and t < 600:
        dd = sum(DEF[d][2] for d in order[:len(dh)])
        sk[0] -= dd*dt
        if sk[0] <= 0: sk.pop(0)
        if sk:
            dh[0] -= dps*len(sk)*dt
            if dh[0] <= 0: dh.pop(0)
        t += dt
    return round(t,1), len(sk), len(dh)

def raid_table():
    rows = []
    for stage, n in ((3,5),(4,6),(5,7),(6,8),(8,10),(10,12)):
        for label, dfs in (('1 autocannon', {'autocannon':1}), ('2 autocannon', {'autocannon':2}), ('2 autocannon + 2 recon', {'autocannon':2,'recon':2}),
                           ('3 autocannon + 1 laser', {'autocannon':3,'laser':1}), ('4 autocannon + 2 laser + 2 recon', {'autocannon':4,'laser':2,'recon':2})):
            t, sk_left, d_left = raid_race(dfs, n)
            rows.append(dict(threatStage=f'S{stage}', raid=f'{n} Skitters ({n*120} HP, {n*8} DPS)', defense=label, cost_M=sum(DEF[d][0]*k for d,k in dfs.items()),
                             result=('WIN' if sk_left==0 else 'LOSS'), secs=t, defenders_lost=sum(dfs.values())-d_left))
    return rows

def fmt_table(rows, cols):
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|'*len(cols)]
    for r in rows: out.append('| ' + ' | '.join(str(r.get(c,'')) for c in cols) + ' |')
    return '\n'.join(out)

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('hex','all'):
        print('hex R10 =', HEX(10), ' R8 =', HEX(8), ' beacon gain at d=10:', beacon_gain(), ' d=14:', beacon_gain(d=14), ' planet R56 =', HEX(56))
    if what in ('terraform','all'):
        owned, denom, fp, rows = terraform_table()
        print(f'owned {owned}, denom {denom:.0f}, footprint {fp}')
        print(fmt_table(rows, ['target','need','reachable','max_pct','drone1_min','drone3_min','E','W','Mi','M']))
    if what in ('matrix','all'):
        rows = []
        M = [('A1 spec defaults (clear 5, family cap, 2 drones)', dict()),
             ('A2 clear 25', dict(clear_yield=25)),
             ('A3 clear 25 + per-sub caps', dict(clear_yield=25, cap_mode='sub')),
             ('A4 A3 + 4 drones', dict(clear_yield=25, cap_mode='sub', extra_terraformers=3)),
             ('A5 A3 + Processor 0.5/s (B1)', dict(clear_yield=25, cap_mode='sub', processor=True)),
             ('A6 A3 + Processor 0.1/s', dict(clear_yield=25, cap_mode='sub', processor=True, processor_rate=0.1)),
             ('A7 A3 + Processor 0.05/s', dict(clear_yield=25, cap_mode='sub', processor=True, processor_rate=0.05)),
             ('A8 trader, Guild T2 = 4x T1', dict(clear_yield=25, cap_mode='sub', trader=True, export=True, guild_ratio=4.0)),
             ('A9 trader, Guild T2 = 8x T1', dict(clear_yield=25, cap_mode='sub', trader=True, export=True, guild_ratio=8.0)),
             ('A10 A3, no beacons', dict(clear_yield=25, cap_mode='sub', beacons=0)),
             ('A11 A3, 1 beacon', dict(clear_yield=25, cap_mode='sub', beacons=1)),
             ('R1 recommended set, solo (kit 400/300/200/150, caps per sub, capacitor 6k, gate 100/230 Living, Hub T2 25 % T2, Processor 0.2, 1 beacon)',
              dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.2, beacons=1)),
             ('R2 recommended set, 2 beacons', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.2, beacons=2)),
             ('R3 recommended set + trader (T2 = 4x T1)', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.2, beacons=1, trader=True, export=True, guild_ratio=4.0)),
             ('R4 recommended set, Processor 0.5 (B1)', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.5, beacons=1)),
             ('R5 recommended set, Processor 0.1', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.1, beacons=1)),
             ('R7 recommended set, Processor 0.3', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.3, beacons=1)),
             ('R8 recommended set, no Processor', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, beacons=1)),
             ('R6 recommended set, 4 drones (3 extra)', dict(clear_yield=25, cap_mode='sub', kit=(400,300,200,150), cap_store=6000, gate_mode='count', t2_share=0.25, processor=True, processor_rate=0.2, beacons=1, extra_terraformers=3))]
        for label, kw in M:
            c, _ = run_colony(minutes=150, **kw); rows.append(summary(label, c))
        print(fmt_table(rows, list(rows[0].keys())))
    if what in ('colony',):
        for label, kw in [('A1 spec defaults (clear 5, family cap)', dict()),
                          ('A2 clear 25', dict(clear_yield=25)),
                          ('A3 clear 25 + sub caps', dict(clear_yield=25, cap_mode='sub')),
                          ('A4 clear 25 + sub caps + 2 extra drones', dict(clear_yield=25, cap_mode='sub', extra_terraformers=3)),
                          ('A5 A3 + processor 0.5/s (B1)', dict(clear_yield=25, cap_mode='sub', processor=True)),
                          ('A6 A3 + processor 0.05/s', dict(clear_yield=25, cap_mode='sub', processor=True, processor_rate=0.05)),
                          ('A7 trader R=4 (A3)', dict(clear_yield=25, cap_mode='sub', trader=True, export=True, guild_ratio=4.0)),
                          ('A8 trader R=8 (A3)', dict(clear_yield=25, cap_mode='sub', trader=True, export=True, guild_ratio=8.0))]:
            c, snaps = run_colony(minutes=120, **kw)
            print('\n##', label)
            print('stages:', {k: f'{v//60}:{v%60:02d}' for k,v in c.stage_t.items()})
            print(fmt_table([snaps[m] for m in sorted(snaps) if m % 10 == 0], ['t','stage','tf','living','M','Mi','W','Bio','M2','Mi2','B2','gen','drain','supply','scap','cap','brown','paused','tE','tW','exported','wasted']))
            print('events:', [(f'{e[0]//60}:{e[0]%60:02d}',)+tuple(e[1:]) for e in c.events if e[1]=='bought' or e[2] in ('hub','factory','beacon','hub_t2','processor','factory_t2','tradehub','petro')])
            print('terraform 30% at', c.tf30 if hasattr(c,'tf30') else None, '50% at', getattr(c,'tf50',None), '70% at', getattr(c,'tf70',None), 'exported', dict((k,int(v)) for k,v in c.exported.items()), 'orbit', dict((k,int(v)) for k,v in c.orbit.items()))
    if what in ('raids','all'):
        r = raid_table(); print(fmt_table(r, list(r[0].keys())))
    if what in ('planet','all'):
        for label, kw in [('k=1, no drain', dict(k=1.0)), ('k=1, drain 25%/visit', dict(k=1.0, guild_drain=0.25)),
                          ('k=0.5, drain 25%', dict(k=0.5, guild_drain=0.25)), ('k=1, drain 25%, cap 20k, fee 2%', dict(k=1.0, guild_drain=0.25, fee_bp=200))]:
            r = planet_week(**kw)
            print('\n##', label, {k:v for k,v in r.items() if k!='hist'})
            print(fmt_table([h for h in r['hist'] if h['slot'] in (0,24)], ['day','slot','p_m','inv_m','p_t2','inv_t2']))
