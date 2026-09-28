import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { relative, dirname, join } from 'node:path'

// Mechanical migration: translate rendered text, never mutate DOM or domain data.
for (const folder of ['src/app', 'src/components', 'src/pages', 'src/overlay']) {
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.tsx') || name.includes('.test.')) continue
    const file = join(folder, name)
    const input = readFileSync(file, 'utf8')
    if (input.includes("import { uiText }")) continue
    const source = ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const edits = []
    const visit = (node) => {
      if (ts.isJsxText(node) && /[А-Яа-яЁё]/.test(node.text)) {
        const value = node.text.replace(/\s+/g, ' ')
        edits.push([node.pos, node.end, `{uiText(${JSON.stringify(value)})}`])
        return
      }
      if (ts.isJsxExpression(node) && node.expression && !node.dotDotDotToken && !ts.isJsxAttribute(node.parent)) {
        const expression = node.expression
        // Translate computed display strings as well as literals. React nodes/functions pass through.
        edits.push([expression.getStart(source), expression.getStart(source), 'uiText('])
        edits.push([expression.end, expression.end, ')'])
      }
      if (ts.isJsxAttribute(node) && ['title', 'placeholder', 'aria-label', 'alt'].includes(node.name.getText(source)) && node.initializer) {
        const init = node.initializer
        if (ts.isStringLiteral(init)) edits.push([init.getStart(source), init.end, `{uiText(${JSON.stringify(init.text)})}`])
        else if (ts.isJsxExpression(init) && init.expression) {
          edits.push([init.expression.getStart(source), init.expression.getStart(source), 'uiText('])
          edits.push([init.expression.end, init.expression.end, ')'])
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!edits.length) continue
    let result = input
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + replacement + result.slice(end)
    let path = relative(dirname(file), 'src/i18n/renderText').replaceAll('\\', '/')
    if (!path.startsWith('.')) path = './' + path
    writeFileSync(file, `import { uiText } from '${path}'\n` + result)
  }
}
