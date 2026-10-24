import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  AlignmentType,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { Tab } from '../shared/types'

type NoteNode = Record<string, unknown>
type Run = TextRun | ExternalHyperlink | ImageRun

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const

/** Turns a note into a Word document that Google Docs, Word, and LibreOffice can open. */
export async function noteToDocx(tab: Tab, readImage: (src: string) => Promise<Buffer | null>): Promise<Buffer> {
  const blocks = await blocksFrom(isRecord(tab.content) ? tab.content : null, readImage, 0)
  for (const module of tab.modules) {
    blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(module.title || (module.kind === 'todo' ? 'To-do' : 'Notes'))] }))
    if (module.kind === 'todo') {
      for (const todo of module.todos) {
        blocks.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: todo.text || ' ', strike: todo.done })]
          })
        )
      }
    }
    blocks.push(...(await blocksFrom(module.content, readImage, 0)))
  }
  if (blocks.length === 0) blocks.push(new Paragraph({ children: [] }))

  const doc = new Document({
    title: tab.title,
    numbering: {
      config: [
        {
          reference: 'doto-numbers',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: 'start' as const
          }))
        }
      ]
    },
    sections: [{ children: blocks }]
  })
  return Packer.toBuffer(doc)
}

async function blocksFrom(root: NoteNode | null, readImage: (src: string) => Promise<Buffer | null>, depth: number): Promise<Array<Paragraph | Table>> {
  const blocks: Array<Paragraph | Table> = []
  const nodes = Array.isArray(root?.content) ? root.content.filter(isRecord) : []
  for (const node of nodes) blocks.push(...(await blockFrom(node, readImage, depth)))
  return blocks
}

async function blockFrom(node: NoteNode, readImage: (src: string) => Promise<Buffer | null>, depth: number): Promise<Array<Paragraph | Table>> {
  const type = typeof node.type === 'string' ? node.type : ''
  if (type === 'heading') {
    const level = finite(isRecord(node.attrs) ? node.attrs.level : 1, 1)
    return [new Paragraph({ heading: HEADINGS[Math.min(6, Math.max(1, level)) - 1], alignment: paragraphAlignment(node), indent: paragraphIndent(node), children: runsFrom(node) })]
  }
  if (type === 'blockquote') return blocksFrom(node, readImage, depth)
  if (type === 'bulletList' || type === 'orderedList') {
    const items: Array<Paragraph | Table> = []
    for (const item of children(node)) {
      if (item.type !== 'listItem') continue
      let used = false
      for (const child of children(item)) {
        if (!used && (child.type === 'paragraph' || child.type === 'heading')) {
          items.push(listParagraph(type === 'orderedList', depth, runsFrom(child)))
          used = true
        } else {
          items.push(...(await blockFrom(child, readImage, child.type === 'bulletList' || child.type === 'orderedList' ? depth + 1 : depth)))
        }
      }
      if (!used) items.push(listParagraph(type === 'orderedList', depth, [new TextRun(' ')]))
    }
    return items
  }
  if (type === 'codeBlock') {
    return [new Paragraph({ children: [new TextRun({ text: textOf(node) || ' ', font: 'Courier New' })] })]
  }
  if (type === 'horizontalRule') {
    return [
      new Paragraph({
        border: { bottom: { color: 'BBBBBB', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        children: []
      })
    ]
  }
  if (type === 'image') return [new Paragraph({ children: await imageRuns(node, readImage) })]
  if (type === 'paragraph') return [await paragraphBlock(node, readImage)]
  if (type === 'localAudio') return [new Paragraph({ children: [new TextRun('Audio recording')] })]
  if (type === 'youtube') {
    const src = isRecord(node.attrs) && typeof node.attrs.src === 'string' ? node.attrs.src : ''
    return [new Paragraph({ children: src ? [linkRun(src, src)] : [new TextRun('Video')] })]
  }
  if (type === 'table') return [await tableFrom(node, readImage)]
  const runs = runsFrom(node)
  return [new Paragraph({ alignment: paragraphAlignment(node), children: runs.length > 0 ? runs : [new TextRun('')] })]
}

function paragraphIndent(node: NoteNode): { left: number } | undefined {
  const level = isRecord(node.attrs) ? Number(node.attrs.indent) : 0
  if (!Number.isInteger(level) || level <= 0) return undefined
  return { left: Math.min(8, level) * 360 }
}

function paragraphAlignment(node: NoteNode): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = isRecord(node.attrs) ? node.attrs.textAlign : null
  if (align === 'center') return AlignmentType.CENTER
  if (align === 'right') return AlignmentType.RIGHT
  if (align === 'left') return AlignmentType.LEFT
  return undefined
}

function listParagraph(numbered: boolean, depth: number, childrenRuns: Run[]): Paragraph {
  const level = Math.min(2, depth)
  return new Paragraph({
    ...(numbered ? { numbering: { reference: 'doto-numbers', level } } : { bullet: { level } }),
    children: childrenRuns
  })
}

async function tableFrom(node: NoteNode, readImage: (src: string) => Promise<Buffer | null>): Promise<Table> {
  const rows: TableRow[] = []
  for (const row of children(node)) {
    if (row.type !== 'tableRow') continue
    const cells: TableCell[] = []
    for (const cell of children(row)) {
      if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue
      const inner = await blocksFrom(cell, readImage, 0)
      cells.push(
        new TableCell({
          children: inner.length > 0 ? inner.filter((block): block is Paragraph => block instanceof Paragraph) : [new Paragraph({})]
        })
      )
    }
    if (cells.length > 0) rows.push(new TableRow({ children: cells, tableHeader: children(row).some((cell) => cell.type === 'tableHeader') }))
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.length > 0 ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph({})] })] })]
  })
}

async function paragraphBlock(node: NoteNode, readImage: (src: string) => Promise<Buffer | null>): Promise<Paragraph> {
  const runs: Run[] = []
  for (const child of children(node)) {
    if (child.type === 'image') runs.push(...(await imageRuns(child, readImage)))
    else if (child.type === 'text' && typeof child.text === 'string') {
      const marks = markOptions(child.marks)
      const href = linkHref(child.marks)
      runs.push(href ? linkRun(child.text, href, marks) : new TextRun({ text: child.text, ...marks }))
    } else if (child.type === 'hardBreak') runs.push(new TextRun({ break: 1 }))
  }
  return new Paragraph({ alignment: paragraphAlignment(node), indent: paragraphIndent(node), children: runs.length > 0 ? runs : [new TextRun('')] })
}

async function imageRuns(node: NoteNode, readImage: (src: string) => Promise<Buffer | null>): Promise<Run[]> {
  const attrs = isRecord(node.attrs) ? node.attrs : {}
  const src = typeof attrs.src === 'string' ? attrs.src : ''
  const data = src ? await readImage(src).catch(() => null) : null
  const type = imageType(src)
  if (!data || !type) return [new TextRun(typeof attrs.alt === 'string' && attrs.alt ? attrs.alt : 'Image')]
  const width = Math.min(600, finite(attrs.width, 480))
  const height = Math.min(800, finite(attrs.height, Math.round(width * 0.56)))
  return [new ImageRun({ type, data, transformation: { width, height } })]
}

function runsFrom(node: NoteNode): Run[] {
  const runs: Run[] = []
  for (const child of children(node)) {
    if (child.type === 'text' && typeof child.text === 'string') {
      const run = new TextRun({ text: child.text, ...markOptions(child.marks) })
      const href = linkHref(child.marks)
      runs.push(href ? linkRun(child.text, href, markOptions(child.marks)) : run)
    } else if (child.type === 'hardBreak') {
      runs.push(new TextRun({ break: 1 }))
    }
  }
  return runs
}

function linkRun(text: string, href: string, options: Record<string, unknown> = {}): ExternalHyperlink {
  return new ExternalHyperlink({
    link: href,
    children: [new TextRun({ text, style: 'Hyperlink', ...options })]
  })
}

function markOptions(marks: unknown): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const mark of Array.isArray(marks) ? marks.filter(isRecord) : []) {
    if (mark.type === 'bold') options.bold = true
    if (mark.type === 'italic') options.italics = true
    if (mark.type === 'underline') options.underline = {}
    if (mark.type === 'strike') options.strike = true
    if (mark.type === 'code') options.font = 'Courier New'
    if (mark.type === 'textStyle' && isRecord(mark.attrs)) {
      if (typeof mark.attrs.fontFamily === 'string' && mark.attrs.fontFamily) options.font = mark.attrs.fontFamily
      if (typeof mark.attrs.color === 'string' && mark.attrs.color.startsWith('#')) options.color = mark.attrs.color.slice(1)
      const size = typeof mark.attrs.fontSize === 'string' ? Number.parseFloat(mark.attrs.fontSize) : Number.NaN
      if (Number.isFinite(size)) options.size = Math.round(size * 1.5)
    }
  }
  return options
}

function linkHref(marks: unknown): string {
  for (const mark of Array.isArray(marks) ? marks.filter(isRecord) : []) {
    if (mark.type === 'link' && isRecord(mark.attrs) && typeof mark.attrs.href === 'string') return mark.attrs.href
  }
  return ''
}

function textOf(node: NoteNode): string {
  return children(node)
    .map((child) => (typeof child.text === 'string' ? child.text : textOf(child)))
    .join('')
}

function children(node: NoteNode): NoteNode[] {
  return Array.isArray(node.content) ? node.content.filter(isRecord) : []
}

function imageType(src: string): 'jpg' | 'png' | 'gif' | 'bmp' | null {
  const match = /\.(png|jpe?g|gif|bmp)(?:$|\?)/i.exec(src)
  if (!match) return null
  return match[1].toLowerCase() === 'png' ? 'png' : match[1].toLowerCase() === 'gif' ? 'gif' : match[1].toLowerCase() === 'bmp' ? 'bmp' : 'jpg'
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
