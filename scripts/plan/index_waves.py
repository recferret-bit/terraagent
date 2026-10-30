"""Index, validate and schedule the product-wave plan (docs/plan/waves/W*.md).

  python3 scripts/plan/index_waves.py            # validate + summary
  python3 scripts/plan/index_waves.py --write    # also write ISSUE_INDEX.md and HACKATHON_SCHEDULE.md
  python3 scripts/plan/index_waves.py --agents 10 --write
  python3 scripts/plan/index_waves.py --waves-json   # wave list for scripts/wave/wave.mjs

Columns are located by the issue-table header row. Deps understand ranges
(`W07-03..07`, `W06-01…W06-27`, `W04-02 … W04-32`), `all above` and `all WNN`.
For a tagged issue, ranges and `all` mean the issues of the same tag set only.

Tags (column `H`): `H` hackathon must, `H+` hackathon stretch, `H2` real-NEAR
phase 2 (after the D10 gate), blank = post-hackathon.
"""
import re, glob, os, sys, collections, heapq

ROOT = 'docs/plan/waves'
UNIT = {'S': 0.5, 'M': 1.0}
ALLOWED = {'H': {'H'}, 'H+': {'H', 'H+'}, 'H2': {'H', 'H2'}, '': {'H', 'H+', 'H2', ''}}
IDRE = re.compile(r'^\|\s*(W\d\d-\d\d)\s*\|')
split = lambda l: [c.strip() for c in re.split(r'(?<!\\)\|', l.rstrip().strip('|'))]
arg = lambda name, default: (sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default)

issues = collections.OrderedDict()
wave_deps = {}
problems = []
for f in sorted(glob.glob(f'{ROOT}/W*.md')):
    wave = os.path.basename(f)[:3]
    cols, in_dep_list = None, False
    for ln, l in enumerate(open(f), 1):
        if l.startswith('| ID |') and '| Deps |' in l:
            cols = {name: i for i, name in enumerate(split(l))}
            continue
        hm = re.search(r'\*\*Depends on[^*]*:\*\*(.*)', l) if l.startswith('>') else None
        if hm:
            head = re.split(r'\.(?:\s|$)|Optional', hm.group(1))[0]
            wave_deps[wave] = re.findall(r'\bW\d\d\b', head)
            in_dep_list = not head.strip()
            continue
        if in_dep_list:
            if l.startswith('> - '):
                if 'optional' not in l.lower():
                    wave_deps[wave] += re.findall(r'\bW\d\d\b', l)
                continue
            in_dep_list = False
        m = IDRE.match(l)
        if not m:
            continue
        iid = m.group(1)
        if cols is None:
            problems.append(f'{f}:{ln} {iid} before any issue-table header')
            continue
        cells = split(l)
        if len(cells) != len(cols):
            problems.append(f'{f}:{ln} {iid} has {len(cells)} cells, header has {len(cols)}')
        if iid in issues:
            problems.append(f'dup {iid} ({f}:{ln})')
            continue
        if not iid.startswith(wave):
            problems.append(f'{iid} in wrong file {f}')
        get = lambda name: cells[cols[name]] if name in cols and cols[name] < len(cells) else ''
        issues[iid] = dict(file=f, wave=wave, title=get('Title'), type=get('Type'), size=get('Size').strip('` '),
                           tag=get('H'), deps_raw=get('Deps'))

order = list(issues)
pos = {iid: i for i, iid in enumerate(order)}


def resolve(iid):
    """Return (hard deps, filtered deps) for an issue; filtered = ranges/`all` limited to the issue's tag set."""
    d = issues[iid]
    raw = d['deps_raw'].replace('…', '..')
    hard, soft = [], []
    for w, a, b in re.findall(r'(W\d\d)-(\d\d)\s*\.\.\s*(?:W\d\d-)?(\d\d)', raw):
        soft += [f'{w}-{n:02d}' for n in range(int(a), int(b) + 1) if f'{w}-{n:02d}' in issues]
    raw2 = re.sub(r'W\d\d-\d\d\s*\.\.\s*(?:W\d\d-)?\d\d', '', raw)
    hard += re.findall(r'W\d\d-\d\d', raw2)
    if re.search(r'\ball above\b', raw):
        soft += [i for i in order if issues[i]['wave'] == d['wave'] and pos[i] < pos[iid]]
    for w in re.findall(r'\ball (W\d\d)\b', raw):
        soft += [i for i in order if issues[i]['wave'] == w and i != iid]
    bare = re.findall(r'\b(W\d\d)\b(?!-)', re.sub(r'\ball W\d\d\b', '', raw2))
    return hard, soft, bare


tagset = lambda t: ALLOWED.get(t, set())
dep_graph = {}
bare_total = 0
for iid, d in issues.items():
    if d['size'] not in UNIT:
        problems.append(f'{iid} size={d["size"]!r}')
    if d['tag'] not in ALLOWED:
        problems.append(f'{iid} tag={d["tag"]!r}')
    hard, soft, bare = resolve(iid)
    bare_total += len(bare)
    for b in bare:
        problems.append(f'{iid} bare wave dep {b} (write an issue id)')
    for dep in hard:
        if dep not in issues:
            problems.append(f'{iid} dep {dep} missing')
    ok = tagset(d['tag'])
    hard = [x for x in hard if x in issues]
    for dep in hard:
        if d['tag'] and issues[dep]['tag'] not in ok:
            problems.append(f'closure: {iid} [{d["tag"]}] needs {dep} [{issues[dep]["tag"] or "-"}]')
    if d['tag']:
        soft = [x for x in soft if issues[x]['tag'] in ok]
    dep_graph[iid] = sorted(set(hard + soft) - {iid}, key=pos.get)

# A wave's e2e needs the e2e of every wave in its header's "Depends on".
e2e = {}
for iid, d in issues.items():
    if re.match(r'(?i)wave e2e', d['title']):
        if d['wave'] in e2e:
            problems.append(f'{d["wave"]} has two wave e2e issues')
        e2e[d['wave']] = iid
for w in sorted({d['wave'] for d in issues.values()}):
    if w not in e2e:
        problems.append(f'{w} has no "Wave e2e" issue')
for w, iid in e2e.items():
    for pw in wave_deps.get(w, []):
        if pw in e2e:
            dep = e2e[pw]
            if issues[iid]['tag'] and issues[dep]['tag'] not in tagset(issues[iid]['tag']):
                problems.append(f'closure: {iid} [{issues[iid]["tag"]}] wave-depends on {dep} [{issues[dep]["tag"] or "-"}]')
            elif dep not in dep_graph[iid]:
                dep_graph[iid].append(dep)


def subgraph(tags):
    nodes = [i for i in order if issues[i]['tag'] in tags]
    s = set(nodes)
    return nodes, {i: [x for x in dep_graph[i] if x in s] for i in nodes}


def longest(nodes, g):
    """Earliest finish (units) per node, and the critical path."""
    fin, via = {}, {}
    seen = set()

    def visit(i, stack=()):
        if i in fin:
            return fin[i]
        if i in stack:
            problems.append(f'cycle via {i}')
            return 0
        best, arg_ = 0.0, None
        for x in g[i]:
            v = visit(x, stack + (i,))
            if v > best:
                best, arg_ = v, x
        fin[i] = best + UNIT[issues[i]['size']]
        via[i] = arg_
        return fin[i]

    for i in nodes:
        visit(i)
    end = max(fin, key=fin.get) if fin else None
    path = []
    while end:
        path.append(end)
        end = via[end]
    return fin, path[::-1]


# Hackathon value order: when time runs out, waves late in this list are the ones left unfinished.
VALUE_ORDER = ['W00', 'W01', 'W02', 'W06', 'W10', 'W13', 'W03', 'W07', 'W05', 'W15', 'W12', 'W08',
               'W04', 'W09', 'W20', 'W22', 'W14', 'W11', 'W25']
VALUE_WEIGHT = 1.0  # one rank step = one unit of remaining path
BUILD_DAYS = 13

if '--waves-json' in sys.argv:  # machine-readable wave list for scripts/wave/wave.mjs
    import json
    waves = {}
    for iid, d in issues.items():
        t = d['tag'] or '-'
        w = waves.setdefault(d['wave'], {'file': d['file'], 'deps': wave_deps.get(d['wave'], []), 'tags': {}, 'issues': {}})
        w['tags'][t] = w['tags'].get(t, 0) + 1
        w['issues'].setdefault(t, []).append(iid)
    print(json.dumps({'valueOrder': VALUE_ORDER, 'waves': waves, 'problems': problems}))
    sys.exit(0)


def schedule(nodes, g, agents):
    """List scheduling in half-unit slots.

    Priority = VALUE_WEIGHT × value rank − longest remaining path, so waves land roughly in value
    order (a working app after each one) while the critical path still goes first.
    """
    rank = {w: k for k, w in enumerate(VALUE_ORDER)}
    prio = lambda i: VALUE_WEIGHT * rank.get(issues[i]['wave'], len(rank)) - tail[i]
    succ = collections.defaultdict(list)
    for i in nodes:
        for x in g[i]:
            succ[x].append(i)
    tail = {}

    def tl(i):
        if i not in tail:
            tail[i] = UNIT[issues[i]['size']] + max((tl(s) for s in succ[i]), default=0)
        return tail[i]

    for i in nodes:
        tl(i)
    left = {i: len(g[i]) for i in nodes}
    ready = [(prio(i), pos[i], i) for i in nodes if left[i] == 0]
    heapq.heapify(ready)
    running, t, start, busy = [], 0.0, {}, 0
    while ready or running:
        while ready and len(running) < agents:
            _, _, i = heapq.heappop(ready)
            start[i] = t
            heapq.heappush(running, (t + UNIT[issues[i]['size']], i))
        t, i = heapq.heappop(running)
        done = [i]
        while running and running[0][0] == t:
            done.append(heapq.heappop(running)[1])
        for i in done:
            for s in succ[i]:
                left[s] -= 1
                if left[s] == 0:
                    heapq.heappush(ready, (prio(s), pos[s], s))
    return start, t


# ---- report
per = collections.Counter(d['wave'] for d in issues.values())
sizes = collections.Counter(d['size'] for d in issues.values())
types = collections.Counter((d['type'].split() or ['?'])[0].lower() for d in issues.values())
effort = lambda ids: sum(UNIT[issues[i]['size']] for i in ids)
tags = collections.Counter(d['tag'] or '-' for d in issues.values())
print('waves', len(per), 'issues', len(issues), 'effort', effort(order))
print(dict(sizes)); print(dict(types)); print('tags', dict(tags))
sets = {'H': {'H'}, 'H+H+': {'H', 'H+'}, 'H+H2': {'H', 'H2'}, 'all': {'H', 'H+', 'H2', ''}}
cp = {}
for name, ts in sets.items():
    nodes, g = subgraph(ts)
    fin, path = longest(nodes, g)
    cp[name] = (nodes, g, fin, path)
    print(f'{name:5} issues {len(nodes):4}  effort {effort(nodes):6.1f}  critical path {fin[path[-1]] if path else 0:5.1f}')
AGENTS = [int(a) for a in arg('--agents', '4,6,8,10,12,16,20').split(',')]
nodes, g, fin, path = cp['H']
span = {n: schedule(nodes, g, n)[1] for n in AGENTS}
print('H makespan by agents:', {n: span[n] for n in AGENTS})
print('bare-wave deps', bare_total)
print('problems', len(problems)); print('\n'.join(problems[:80]))

if '--write' in sys.argv:
    out = ['# Issue Index (generated)', '',
           f'> Generated by `scripts/plan/index_waves.py` from [`waves/`](./waves/). **{len(issues)} issues in {len(per)} waves** · '
           f'S {sizes["S"]} · M {sizes["M"]} · effort ≈ {effort(order):.0f} agent-days (S = ½, M = 1). '
           f'Hackathon tags: **H** {tags["H"]} must · **H+** {tags["H+"]} stretch · **H2** {tags["H2"]} real-NEAR phase 2 '
           f'(see [`HACKATHON_SCHEDULE.md`](./HACKATHON_SCHEDULE.md)).', '',
           '| Wave | Issues | S | M | Effort | H | H effort | H+ | H2 |', '|---|---|---|---|---|---|---|---|---|']
    for w in sorted(per):
        ids = [i for i in order if issues[i]['wave'] == w]
        h = [i for i in ids if issues[i]['tag'] == 'H']
        out.append(f'| {w} | {len(ids)} | {sum(issues[i]["size"] == "S" for i in ids)} | {sum(issues[i]["size"] == "M" for i in ids)} | '
                   f'{effort(ids):.1f} | {len(h) or ""} | {effort(h) or "":} | {sum(issues[i]["tag"] == "H+" for i in ids) or ""} | '
                   f'{sum(issues[i]["tag"] == "H2" for i in ids) or ""} |')
    out += ['', '| ID | Title | Type | Size | H | Deps |', '|---|---|---|---|---|---|']
    for i, d in issues.items():
        out.append(f'| [{i}]({os.path.relpath(d["file"], "docs/plan")}) | {d["title"]} | {d["type"]} | {d["size"]} | {d["tag"]} | {d["deps_raw"]} |')
    open('docs/plan/ISSUE_INDEX.md', 'w').write('\n'.join(out) + '\n')

    n = int(arg('--plan-agents', '10'))
    start, makespan = schedule(nodes, g, n)
    crit = set(path)
    hn = cp['H'][0]
    s = ['# Hackathon Schedule (generated)', '',
         f'> Generated by `scripts/plan/index_waves.py --write` from the `H` column of [`waves/`](./waves/). '
         f'Do not edit by hand: change tags or deps in the wave files and regenerate. Context and the calendar mapping: '
         f'[`HACKATHON_CUT.md`](./HACKATHON_CUT.md).', '',
         '## 1. Numbers', '',
         '| Set | Issues | Effort (units) | Critical path (units) |', '|---|---|---|---|']
    labels = {'H': '**H** (must)', 'H+H+': 'H + H+ (stretch)', 'H+H2': 'H + H2 (real NEAR)', 'all': 'Whole plan'}
    for name, (nn, _, ff, pp) in cp.items():
        s.append(f'| {labels[name]} | {len(nn)} | {effort(nn):.1f} | {ff[pp[-1]]:.1f} |')
    s += ['', 'One **unit** = one M issue (an S is ½). The critical path is the longest chain of dependencies, '
          'including each wave e2e waiting for the e2e of the waves it depends on. No number of agents finishes faster than it.', '',
          '**Must set (H): finish time by number of parallel agents.** List scheduling: an idle agent takes the ready issue '
          'with the best `value rank − remaining path` (value order: ' + ' '.join(VALUE_ORDER) + '), '
          'so waves land roughly in that order and the critical path still goes first.', '',
          '| Agents | ' + ' | '.join(str(a) for a in AGENTS) + ' |', '|---' * (len(AGENTS) + 1) + '|',
          '| Units to finish | ' + ' | '.join(f'{span[a]:.1f}' for a in AGENTS) + ' |',
          '| Merges per unit (avg) | ' + ' | '.join(f'{len(hn) / span[a]:.1f}' for a in AGENTS) + ' |',
          '| Days at 1 unit/agent/day | ' + ' | '.join(f'{span[a]:.1f}' for a in AGENTS) + ' |',
          '| Days at 2 units/agent/day | ' + ' | '.join(f'{span[a] / 2:.1f}' for a in AGENTS) + ' |',
          '| Days at 3 units/agent/day | ' + ' | '.join(f'{span[a] / 3:.1f}' for a in AGENTS) + ' |', '',
          f'The build window has **{BUILD_DAYS} build days** (Nov 1–13; Nov 14 is submission). '
          'Units/agent/day is the measured throughput of one agent including review, CI and merge; '
          'see the calibration rule in HACKATHON_CUT.md.', '',
          '## 2. Critical path (H)', '',
          '| # | Issue | Size | Finishes at | Title |', '|---|---|---|---|---|']
    for k, i in enumerate(path, 1):
        s.append(f'| {k} | [{i}]({os.path.relpath(issues[i]["file"], "docs/plan")}) | {issues[i]["size"]} | {fin[i]:.1f} | {issues[i]["title"][:110]} |')
    s += ['', f'## 3. Start order with {n} agents (H)', '',
          f'Issues grouped by the unit in which they start (`--plan-agents {n}`); ★ = on the critical path. '
          f'Finishes after **{makespan:.1f} units**. An agent that runs out of H work picks the next ready H+ issue of the same wave.', '']
    byslot = collections.defaultdict(list)
    for i, t in start.items():
        byslot[int(t)].append(i)
    s += ['| Unit | Waves active | Starts |', '|---|---|---|']
    for u in sorted(byslot):
        ids = sorted(byslot[u], key=pos.get)
        waves = ' '.join(sorted({issues[i]['wave'] for i in ids}))
        s.append(f'| {u + 1} | {waves} | ' + ', '.join(f'{i}{"★" if i in crit else ""}' for i in ids) + ' |')
    s += ['', '## 4. Wave e2e finish (H)', '', '| Wave | e2e issue | Earliest finish (∞ agents) | Finish with ' + str(n) + ' agents |', '|---|---|---|---|']
    for w, i in sorted(e2e.items()):
        if issues[i]['tag'] == 'H':
            s.append(f'| {w} | {i} | {fin[i]:.1f} | {start[i] + UNIT[issues[i]["size"]]:.1f} |')
    open('docs/plan/HACKATHON_SCHEDULE.md', 'w').write('\n'.join(s) + '\n')
    print('written ISSUE_INDEX.md, HACKATHON_SCHEDULE.md')
