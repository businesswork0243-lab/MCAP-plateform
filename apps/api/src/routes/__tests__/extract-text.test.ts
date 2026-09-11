import { describe, it, expect } from 'vitest'
import { extractTextFromBuffer } from '../brand'

// Every PDF uploaded as a brand document came back as "No text found".
// pdf-parse 2.x exports a PDFParse class, but the code called the module as a
// v1-style function; that threw "pdfParse is not a function", the catch turned
// it into empty text, and the AI never saw a single brand PDF.

/** Smallest valid single-page PDF carrying one line of text. */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

describe('extractTextFromBuffer', () => {
  it('extracts text from a PDF', async () => {
    const pdf = makePdf('Jay Smith builds the Distributed Institutional Ecosystem.')
    const { text, method } = await extractTextFromBuffer(pdf, 'application/pdf', 'jay.pdf')

    expect(method).toBe('pdf-parse')
    expect(text).toContain('Distributed Institutional Ecosystem')
  })

  it('strips the page markers pdf-parse 2.x appends', async () => {
    const { text } = await extractTextFromBuffer(
      makePdf('Governance is distinct from execution.'),
      'application/pdf',
      'x.pdf'
    )
    expect(text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/)
  })

  it('reports a corrupt PDF as failed rather than throwing', async () => {
    const { text, method } = await extractTextFromBuffer(
      Buffer.from('not a pdf at all'),
      'application/pdf',
      'broken.pdf'
    )
    expect(text).toBe('')
    expect(method).toBe('failed')
  })

  it('still reads plain text', async () => {
    const { text, method } = await extractTextFromBuffer(
      Buffer.from('  Keep claims tied to actual experience.  '),
      'text/plain',
      'notes.txt'
    )
    expect(method).toBe('text')
    expect(text).toBe('Keep claims tied to actual experience.')
  })
})
