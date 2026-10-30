# Plain HP/damage battle model. Units of distance = tiles (1 tile = 2 m), time = s.
# Weapons: bullet/shell/rocket = projectiles (flight = dist/speed; aim at target position predicted
# by its velocity at fire time; evasive targets change heading every 0.5 s, so drift = v*max(0,t-0.5)*2
# (worst-case reversal); hit if drift <= aoe + radius). laser = instant hit.
# AoE: centre target full damage, up to floor(2*aoe) more targets in the blob take 50 %.
import math
W = {  # kind, dmg/shot, shots/s, range, minr, proj speed, aoe, hitsGround, hitsAir
 'bullet_s':('bullet', 7,2.0, 4,0,20,0.0,1,0),
 'rocket_t':('rocket',36,1.0, 5,0,10,1.0,1,0),
 'shell_a': ('shell', 90,0.5,14,3, 4,1.5,1,0),
 'laser_aa':('laser', 15,4.0,10,0, 0,0.0,0,1),
 'rocket_f':('rocket',40,1.0, 6,0,15,0.0,0,1),
 'bullet_g':('bullet',16,2.0, 5,0,20,0.0,1,0),
 'bomb_b':  ('shell',100,0.5, 2,0, 4,1.5,1,0),
 'bullet_t':('bullet', 9,2.0, 8,0,20,0.0,1,1),
}
# name: cost, supply, hp, speed, radius, evasive, air, weapon
U = {
 'recon':  (100,1, 240,3.0,0.4,1,0,'bullet_s'),
 'tank':   (300,2, 900,1.2,0.7,0,0,'rocket_t'),
 'arty':   (320,2, 320,1.1,0.6,0,0,'shell_a'),
 'aa':     (230,2, 480,1.5,0.6,0,0,'laser_aa'),
 'fighter':(270,2, 380,5.0,0.5,1,1,'rocket_f'),
 'gunship':(340,2, 650,3.0,0.7,1,1,'bullet_g'),
 'bomber': (520,3, 850,3.5,0.8,1,1,'bomb_b'),
}
def can_hit(a,b):
    w=W[U[a][7]]; return (w[8] if U[b][6] else w[7])
def hit(a,b,d,moving_b):
    k,dmg,rof,rng,minr,ps,aoe,_,_=W[U[a][7]]
    if k=='laser': return True
    t=d/ps; v=U[b][3]
    if U[b][5]: drift=v*max(0,t-0.5)*2   # evasive always moves when engaged
    else: drift=0                        # straight/stationary -> lead aim works
    return drift<=aoe+U[b][4]
def fight(a,na,b,nb,d0=16.0,dt=0.05,T=400):
    A=[U[a][2]]*na; B=[U[b][2]]*nb; pa,pb=0.0,d0; t=0; cdA=cdB=0.0
    def shoot(att,defs,d):
        k,dmg,rof,rng,minr,ps,aoe,_,_=W[U[att][7]]
        alive=[i for i,h in enumerate(defs) if h>0]
        if not alive: return
        extra=int(2*aoe)
        defs[alive[0]]-=dmg
        for i in alive[1:1+extra]: defs[i]-=dmg*0.5
    while t<T and any(h>0 for h in A) and any(h>0 for h in B):
        d=pb-pa
        ca,cb=can_hit(a,b),can_hit(b,a)
        wa,wb=W[U[a][7]],W[U[b][7]]
        ina=ca and wa[4]<=d<=wa[3]; inb=cb and wb[4]<=d<=wb[3]
        movingA = ca and d>wa[3]; movingB = cb and d>wb[3]
        if ina:
            cdA-=dt
            while cdA<=0:
                for _ in range(sum(h>0 for h in A)):
                    if hit(a,b,d,movingB): shoot(a,B,d)
                cdA+=1/wa[2]
        if inb:
            cdB-=dt
            while cdB<=0:
                for _ in range(sum(h>0 for h in B)):
                    if hit(b,a,d,movingA): shoot(b,A,d)
                cdB+=1/wb[2]
        if movingA: pa+=U[a][3]*dt
        if movingB: pb-=U[b][3]*dt
        if ca and d<wa[4]: pa-=U[a][3]*dt*0.5
        if cb and d<wb[4]: pb+=U[b][3]*dt*0.5
        if not ca and not cb: break
        t+=dt
    return sum(h>0 for h in A),sum(h>0 for h in B),round(t,1)
pairs=[('tank','recon'),('arty','tank'),('recon','arty'),('aa','gunship'),('aa','bomber'),('aa','fighter'),
       ('fighter','gunship'),('fighter','bomber'),('gunship','recon'),('gunship','arty'),('bomber','tank'),('bomber','arty'),('tank','aa'),('arty','aa')]
for mode in ('cost','supply'):
    print('==',mode)
    for a,b in pairs:
        if mode=='cost': na=max(1,round(1200/U[a][0])); nb=max(1,round(1200/U[b][0]))
        else: na=12//U[a][1]; nb=12//U[b][1]
        r=fight(a,na,b,nb); ok = r[0]>0 and r[1]==0
        print(f"{a:8}{na:3} vs {b:8}{nb:3} -> {r[0]}/{na} : {r[1]}/{nb}  {r[2]}s {'OK' if ok and r[0]/na>=0.5 else 'WEAK' if ok else 'FAIL'}")
