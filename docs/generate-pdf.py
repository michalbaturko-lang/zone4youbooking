#!/usr/bin/env python3
"""Generate PDF from the questionnaire markdown file."""

import markdown
from weasyprint import HTML

# Read markdown
with open("/home/user/zone4youbooking/docs/dotazy-funkcionalita-klient.md", "r", encoding="utf-8") as f:
    md_content = f.read()

# Convert markdown to HTML
html_body = markdown.markdown(md_content, extensions=["extra", "sane_lists"])

# Wrap in styled HTML document
html_doc = f"""<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<style>
  @page {{
    size: A4;
    margin: 25mm 20mm 25mm 20mm;
    @bottom-center {{
      content: counter(page) " / " counter(pages);
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 9px;
      color: #94A3B8;
    }}
  }}
  body {{
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    line-height: 1.6;
    color: #1E293B;
  }}
  h1 {{
    font-size: 22px;
    color: #E67E22;
    border-bottom: 3px solid #E67E22;
    padding-bottom: 10px;
    margin-bottom: 8px;
  }}
  h1 + p {{
    font-size: 12px;
    color: #475569;
    margin-bottom: 20px;
  }}
  h2 {{
    font-size: 15px;
    color: #334155;
    margin-top: 24px;
    margin-bottom: 10px;
    padding-bottom: 5px;
    border-bottom: 1px solid #E2E8F0;
  }}
  hr {{
    border: none;
    border-top: 1px solid #E2E8F0;
    margin: 20px 0;
  }}
  ul {{
    padding-left: 18px;
    margin-bottom: 10px;
  }}
  li {{
    margin-bottom: 8px;
  }}
  li ul {{
    margin-top: 6px;
    margin-bottom: 4px;
  }}
  li ul li {{
    margin-bottom: 4px;
  }}
  strong {{
    color: #1E293B;
  }}
  em {{
    color: #64748B;
    font-style: italic;
  }}
  /* Checkboxes in summary */
  li input[type="checkbox"] {{
    margin-right: 6px;
  }}
  /* Last section styling */
  h2:last-of-type {{
    color: #E67E22;
  }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

# Generate PDF
output_path = "/home/user/zone4youbooking/docs/dotazy-funkcionalita-klient.pdf"
HTML(string=html_doc).write_pdf(output_path)
print(f"PDF generated: {output_path}")
