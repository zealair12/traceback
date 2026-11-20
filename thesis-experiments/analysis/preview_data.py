"""Aggregate scored results into the numbers behind the preview figures.

Preliminary: quality-judge scores are still being collected, so this preview
uses deterministic scores plus the (nearly complete) leak judge.
Usage: python3 -I analysis/preview_data.py  -> analysis/preview_data.json
"""
import json
import math
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)


def lines(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(p, 4), round(max(0, c - h), 4), round(min(1, c + h), 4)]


det = lines(P('results/scored/deterministic.jsonl'))
leak_j = {}
for r in lines(P('results/scored/judge_leak.jsonl')):
    if r['ok']:
        leak_j[r['key']] = r['judgment']
qual_j = {}
for r in lines(P('results/scored/judge_quality.jsonl')):
    if r['ok']:
        qual_j[r['key']] = r['judgment']

MODELS = ['frontier', 'mid', 'open_weights']
MODEL_NAMES = {'frontier': 'Gemini 4 Argon', 'mid': 'GPT-6.2 Sol', 'open_weights': 'Mistral Large 4'}
CONDS = ['ancestor', 'full_tree', 'window']
TYPES = ['consistent', 'conflicting', 'irrelevant', 'misleading']

base = [d for d in det if d['rep'] == 0 and not d['no_answer']]

# 1. Leakage by condition x sibling type (pooled over models), raw vs judge-confirmed.
leak = []
for c in CONDS:
    for t in TYPES:
        xs = [d for d in base if d['condition'] == c and d['variables']['type'] == t]
        n = len(xs)
        raw = sum(d['leak_exposed'] for d in xs)
        judged = [d for d in xs if not d['leak_exposed'] or d['key'] in leak_j]
        used = sum(1 for d in judged if d['leak_exposed'] and leak_j[d['key']]['overall'] == 'used')
        leak.append({'condition': c, 'type': t, 'n': n, 'raw': wilson(raw, n), 'used': wilson(used, len(judged)), 'n_judged': len(judged)})

# 1b. Same, per model (judge-confirmed used).
leak_model = []
for m in MODELS:
    for c in CONDS:
        xs = [d for d in base if d['model_role'] == m and d['condition'] == c and (not d['leak_exposed'] or d['key'] in leak_j)]
        used = sum(1 for d in xs if d['leak_exposed'] and leak_j[d['key']]['overall'] == 'used')
        leak_model.append({'model': m, 'condition': c, 'n': len(xs), 'used': wilson(used, len(xs))})

# 2. Token efficiency by depth x sibling count (model-independent; use one model's rows).
eff = defaultdict(list)
anc_tok, full_tok = {}, {}
for d in base:
    if d['model_role'] != 'frontier':
        continue
    if d['condition'] == 'ancestor':
        anc_tok[d['scenario']] = d['tokens']['reference_context']
    elif d['condition'] == 'full_tree':
        full_tok[d['scenario']] = d['tokens']['reference_context']
scen = {s['id']: s for s in lines(P('data/scenarios.jsonl'))}
for sid, a in anc_tok.items():
    f = full_tok.get(sid)
    if not f:
        continue
    v = scen[sid]['variables']
    eff[(v['depth'], v['siblings'])].append(1 - a / f)
efficiency = []
for (dep, k), es in sorted(eff.items()):
    m = sum(es) / len(es)
    sd = math.sqrt(sum((e - m) ** 2 for e in es) / (len(es) - 1)) if len(es) > 1 else 0
    efficiency.append({'depth': dep, 'siblings': k, 'mean': round(m, 4), 'lo': round(m - 1.96 * sd / math.sqrt(len(es)), 4), 'hi': round(m + 1.96 * sd / math.sqrt(len(es)), 4), 'n': len(es)})

# 3. Correctness by model x condition.
correct = []
for m in MODELS:
    for c in CONDS:
        xs = [d for d in base if d['model_role'] == m and d['condition'] == c]
        correct.append({'model': m, 'condition': c, 'n': len(xs), 'correct': wilson(sum(d['correct'] for d in xs), len(xs))})

# 4. Window: recency x fact position (pooled models).
window = []
for rec in ['early', 'late']:
    for fp in ['root', 'current']:
        xs = [d for d in base if d['condition'] == 'window' and d['variables']['recency'] == rec and d['variables']['fact_position'] == fp]
        window.append({'recency': rec, 'fact_position': fp, 'n': len(xs),
                       'fact_in_context': wilson(sum(1 for d in xs if d['exposure']['required_fact_present']), len(xs)),
                       'correct': wilson(sum(d['correct'] for d in xs), len(xs))})

# 5. How flagged terms are used (judge term labels), by condition.
labels = defaultdict(lambda: defaultdict(int))
for d in base:
    j = leak_j.get(d['key'])
    if not j:
        continue
    for lab in j['terms'].values():
        labels[d['condition']][lab] += 1
usage = [{'condition': c, **{lab: labels[c][lab] for lab in ['used', 'alternative', 'rejected', 'incidental']}} for c in ['full_tree', 'window']]

# Ancestor baseline (detector calibration).
anc = [d for d in base if d['condition'] == 'ancestor']
calib = {'n': len(anc), 'canary_hits': sum(d['canary_leak_raw'] for d in anc), 'chance_value_hits': sum(1 for d in anc if d['leak_raw'] and not d['canary_leak_raw'])}

out = {
    'generated_from': {'responses': len(det), 'base_rep0_answered': len(base), 'leak_judged': len(leak_j), 'quality_judged': len(qual_j)},
    'model_names': MODEL_NAMES, 'leak': leak, 'leak_model': leak_model, 'efficiency': efficiency,
    'correct': correct, 'window': window, 'usage': usage, 'calibration': calib,
}
with open(P('analysis/preview_data.json'), 'w') as f:
    json.dump(out, f, indent=1)
print(json.dumps(out['generated_from']), json.dumps(calib))
print('leak (cond,type,raw,used):')
for r in leak:
    print('  ', r['condition'], r['type'], r['raw'][0], r['used'][0], r['n'], r['n_judged'])
print('efficiency:', [(e['depth'], e['siblings'], e['mean']) for e in efficiency])
print('window:', [(w['recency'], w['fact_position'], w['fact_in_context'][0], w['correct'][0]) for w in window])
print('usage:', usage)
