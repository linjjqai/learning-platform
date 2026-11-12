"""把人给的课件（pptx / pdf / docx）转成结构化 markdown，供后续人工整理进学习平台。

用法：
  python tools/extract_material.py _inbox/crm

输出：
  _inbox/_extracted/<原名>.md      每页/每段一块，保留标题、正文、备注、图片数量
  _inbox/_extracted/_index.md      所有文件的清单与页数，方便核对是否给全
"""
import sys
import re
from pathlib import Path

# Windows 控制台默认 GBK，强制 UTF-8 输出，避免中文/符号报错
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
INBOX = ROOT / "_inbox"


def norm(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r", "")
    text = re.sub(r"[ \t]+", " ", text)
    return "\n".join(line.strip() for line in text.split("\n") if line.strip())


def extract_pptx(path: Path) -> str:
    from pptx import Presentation

    prs = Presentation(str(path))
    out = [f"# {path.stem}", f"\n> 共 {len(prs.slides)} 页 · 文件 {path.name}\n"]
    for i, slide in enumerate(prs.slides, 1):
        title = ""
        try:
            if slide.shapes.title is not None:
                title = norm(slide.shapes.title.text)
        except Exception:
            title = ""
        blocks, pics, tables = [], 0, 0
        for shape in slide.shapes:
            if shape.has_text_frame:
                t = norm(shape.text_frame.text)
                if t and t != title:
                    blocks.append(t)
            if shape.shape_type == 13:  # PICTURE
                pics += 1
            if getattr(shape, "has_table", False) and shape.has_table:
                tables += 1
                rows = []
                for r in shape.table.rows:
                    rows.append(" | ".join(c.text.strip() for c in r.cells))
                blocks.append("表格：\n" + "\n".join(rows))
        try:
            notes = norm(slide.notes_slide.notes_text_frame.text) if slide.has_notes_slide else ""
        except Exception:
            notes = ""
        out.append(f"\n## 第 {i} 页{' · ' + title if title else ''}")
        if blocks:
            out.append("\n".join(blocks))
        meta = []
        if pics:
            meta.append(f"图片 {pics} 张")
        if tables:
            meta.append(f"表格 {tables} 个")
        if meta:
            out.append(f"_[{' · '.join(meta)}]_")
        if notes:
            out.append(f"\n**备注**：{notes}")
    return "\n".join(out)


def extract_pdf(path: Path) -> str:
    out = [f"# {path.stem}", f"\n> 文件 {path.name}\n"]
    try:
        import fitz  # PyMuPDF
    except ImportError:
        fitz = None
    if fitz is not None:
        doc = fitz.open(str(path))
        for i, page in enumerate(doc, 1):
            out.append(f"\n## 第 {i} 页\n{norm(page.get_text())}")
        return "\n".join(out)
    # 退路：pypdf
    try:
        from pypdf import PdfReader
    except ImportError:
        return f"# {path.stem}\n\n_无法解析 PDF：缺少 PyMuPDF/pypdf_"
    reader = PdfReader(str(path))
    for i, page in enumerate(reader.pages, 1):
        out.append(f"\n## 第 {i} 页\n{norm(page.extract_text() or '')}")
    return "\n".join(out)


def extract_docx(path: Path) -> str:
    import docx

    d = docx.Document(str(path))
    out = [f"# {path.stem}", f"\n> 文件 {path.name}\n"]
    for p in d.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        style = (p.style.name or "").lower()
        if style.startswith("heading"):
            level = "".join(ch for ch in style if ch.isdigit()) or "2"
            out.append(f"\n{'#' * min(int(level) + 1, 6)} {t}")
        else:
            out.append(t)
    return "\n".join(out)


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else INBOX / "crm"
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        print(f"目录不存在: {src}")
        return 1
    out_dir = INBOX / "_extracted"
    out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted([p for p in src.rglob("*") if p.suffix.lower() in {".pptx", ".pdf", ".docx"}])
    if not files:
        print(f"{src} 下没有 pptx / pdf / docx 文件")
        return 1

    index = ["# 素材清单\n", f"来源目录：`{src}`\n"]
    for f in files:
        try:
            if f.suffix.lower() == ".pptx":
                md = extract_pptx(f)
            elif f.suffix.lower() == ".pdf":
                md = extract_pdf(f)
            else:
                md = extract_docx(f)
        except Exception as e:  # 单个文件失败不影响其他
            md = f"# {f.stem}\n\n_解析失败：{e}_"
        target = out_dir / (f.stem + ".md")
        if target.exists():  # 同名的 pptx / pdf 不互相覆盖
            target = out_dir / f"{f.stem}-{f.suffix.lstrip('.')}.md"
        target.write_text(md, encoding="utf-8")
        pages = md.count("\n## ")
        index.append(f"- [x] `{f.relative_to(src)}` → `{target.name}`（{pages} 段）")
        print(f"✓ {f.name} -> {target.name} ({pages} 段)")
    (out_dir / "_index.md").write_text("\n".join(index), encoding="utf-8")
    print(f"\n清单：{out_dir / '_index.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
