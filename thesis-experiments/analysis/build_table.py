"""Phase 7, step 1: one tidy table, one row per model answer.

Joins deterministic scores, the leak judge and the quality judge (successful
judgment per key; failed retry lines are ignored). This table is the single
source for every number in the thesis.

Usage: python3 -I analysis/build_table.py
Writes results/analysis/answers.csv and results/analysis/scenarios.csv
"""
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)


def lines(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def ok_by_key(path):
    out = {}
    for r in lines(path):
        if r.get('ok'):
            out[r['key']] = r['judgment']
    return out


det = lines(P('results/scored/deterministic.jsonl'))
scen_by_id = {s['id']: s for s in lines(P('data/scenarios.jsonl'))}
leak_j = ok_by_key(P('results/scored/judge_leak.jsonl'))
qual_j = ok_by_key(P('results/scored/judge_quality.jsonl'))
os.makedirs(P('results/analysis'), exist_ok=True)

rows, missing_leak, missing_q = [], 0, 0
for d in det:
    v = d['variables']
    lj = leak_j.get(d['key'])
    if d['needs_leak_judge'] and lj is None:
        missing_leak += 1
    labels = list(lj['terms'].values()) if lj else []
    leak_used = 1 if (d['leak_exposed'] and lj and lj['overall'] == 'used') else 0
    # Correctness as the brief defines it: required value present and no conflicting
    # sibling value ASSERTED. A conflicting value only mentioned (as an alternative or
    # rejected) is not asserted; the leak judge's term labels decide. Without a judge
    # label (unflagged answers) any conflicting value present counts as asserted.
    conflict_vals = [p['value'] for p in scen_by_id[d['scenario']]['planted'] if p['value']]
    if lj:
        asserted = [t for t, lab in lj['terms'].items() if lab == 'used' and t in conflict_vals]
    else:
        asserted = [t for t in d['leaked_items_exposed'] if t in conflict_vals]
    correct_judged = 0 if d['no_answer'] else int(d['correct_value_present'] and not asserted)
    q = qual_j.get(d['key'])
    if not d['no_answer'] and q is None:
        missing_q += 1
    rows.append({
        'key': d['key'], 'model': d['model'], 'model_role': d['model_role'], 'scenario': d['scenario'],
        'domain': d['domain'], 'condition': d['condition'], 'rep': d['rep'],
        'depth': v['depth'], 'siblings': v['siblings'], 'type': v['type'], 'recency': v['recency'],
        'fact_position': v['fact_position'],
        'rerun_d1': int(d['rerun'] is not None), 'no_answer': int(d['no_answer']),
        'correct': correct_judged, 'correct_strict': d['correct'], 'correct_value_present': int(d['correct_value_present']),
        'leak_raw': d['leak_raw'], 'leak_exposed': d['leak_exposed'], 'leak_used': leak_used,
        'canary_leak_exposed': d['canary_leak_exposed'], 'value_leak_exposed': d['value_leak_exposed'],
        'chance_hit': int(bool(d['chance_items']) and not d['leak_exposed']),
        'terms_used': labels.count('used'), 'terms_alternative': labels.count('alternative'),
        'terms_rejected': labels.count('rejected'), 'terms_incidental': labels.count('incidental'),
        'planted_in_context': int(d['exposure']['any_planted_in_context']),
        'canaries_in_context': d['exposure']['canaries_in_context'],
        'values_in_context': d['exposure']['values_in_context'],
        'sibling_messages_in_context': d['exposure']['sibling_messages'],
        'required_fact_present': int(d['exposure']['required_fact_present']),
        'q_faithfulness': q['contextual_faithfulness'] if q else '',
        'q_instruction': q['instruction_following'] if q else '',
        'q_task': q['task_completion'] if q else '',
        'ref_context_tokens': d['tokens']['reference_context'], 'budget_tokens': d['tokens']['budget'],
        'prompt_tokens': d['tokens']['prompt_usage'], 'completion_tokens': d['tokens']['completion_usage'],
        'window_ratio': d['window_ratio'], 'cost_usd': d['cost_usd'],
    })

with open(P('results/analysis/answers.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

# Per-scenario token efficiency (model-independent: reference tokenizer).
anc, full = {}, {}
for r in rows:
    if r['rep'] == 0 and r['model_role'] == 'frontier':
        if r['condition'] == 'ancestor':
            anc[r['scenario']] = r['ref_context_tokens']
        elif r['condition'] == 'full_tree':
            full[r['scenario']] = r['ref_context_tokens']
scen = {s['id']: s for s in lines(P('data/scenarios.jsonl'))}
srows = []
for sid, s in scen.items():
    v = s['variables']
    srows.append({'scenario': sid, 'domain': s['domain'], 'depth': v['depth'], 'siblings': v['siblings'], 'type': v['type'],
                  'recency': v['recency'], 'fact_position': v['fact_position'],
                  'ancestor_tokens': anc[sid], 'full_tree_tokens': full[sid],
                  'efficiency': 1 - anc[sid] / full[sid], 'sibling_share': (full[sid] - anc[sid]) / full[sid]})
with open(P('results/analysis/scenarios.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(srows[0].keys()))
    w.writeheader()
    w.writerows(srows)

print(f"answers.csv: {len(rows)} rows; missing leak judgments {missing_leak}; missing quality judgments {missing_q}")
print(f"scenarios.csv: {len(srows)} rows")
