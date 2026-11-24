"""Puts translated chunks together: python -I scripts/i18n/merge-chunks.py <chunk folder> <out folder> [lang ...]
<chunk folder>/<name>.<lang>.json -> <out folder>/<lang>.json (default de, ja, zh), merged with what is there already, keys sorted."""
import glob, json, os, sys

folder, out = sys.argv[1], sys.argv[2]
for lang in sys.argv[3:] or ('de', 'ja', 'zh'):
    path = os.path.join(out, f'{lang}.json')
    table = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    added = 0
    for chunk in sorted(glob.glob(os.path.join(folder, f'*.{lang}.json'))):
        for english, text in json.load(open(chunk, encoding='utf-8')).items():
            if isinstance(text, str) and text.strip():
                added += english not in table
                table[english] = text
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(dict(sorted(table.items())), handle, ensure_ascii=False, indent=0)
        handle.write('\n')
    print(f'{lang}: {len(table)} phrases ({added} new)')
