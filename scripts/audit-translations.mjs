import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import vm from 'node:vm'
const source = fs.readFileSync('src/i18n/uiEnglish.ts', 'utf8')
const compiled = ts.transpile(source.replace('export function translateUiText', 'function translateUiText'), { target: ts.ScriptTarget.ES2022 })
const translate = vm.runInNewContext(`${compiled}; translateUiText`)
const missing = new Map()
for (const dir of ['src/app', 'src/pages', 'src/components', 'src/overlay']) {
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
    const file = path.join(dir, name)
    const node = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(entry) {
      if ((ts.isStringLiteral(entry) || ts.isNoSubstitutionTemplateLiteral(entry) || ts.isTemplateHead(entry) || ts.isTemplateMiddle(entry) || ts.isTemplateTail(entry)) && /[А-Яа-яЁё]/.test(entry.text) && /[А-Яа-яЁё]/.test(translate(entry.text))) {
        missing.set(entry.text, translate(entry.text))
      }
      ts.forEachChild(entry, visit)
    }
    visit(node)
  }
}
for (const [original, result] of missing) console.log(JSON.stringify([original, result]))
console.log(`Missing: ${missing.size}`)
