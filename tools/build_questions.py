from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from docx import Document

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path(r"C:\Users\lenovo\Downloads")
CHAPTERS = [
    ("intro", "绪论", "绪论", "绪论.docx"),
    ("ch1", "第一章", "世界的物质性及发展规律", "第一章.docx"),
    ("ch2", "第二章", "实践与认识及其发展规律", "第二章.docx"),
    ("ch3", "第三章", "人类社会及其发展规律", "第三章.docx"),
    ("ch4", "第四章", "资本主义的本质及规律", "第四章.docx"),
    ("ch5", "第五章", "资本主义的发展及其趋势", "第五章.docx"),
    ("ch6", "第六章", "社会主义的发展及其规律", "第六章.docx"),
    ("ch7", "第七章", "共产主义崇高理想及其最终实现", "第七章.docx"),
    ("focus", "主观题精选", "2026 年秋季学期重点", "马原主观题题库.docx"),
]
QUESTION_START = re.compile(r"^\s*(\d+)\s*[.．、]\s*(.*)$", re.S)
OPTION_START = re.compile(r"^\s*([A-H])\s*(?:[.．、]\s*)?(.*)$", re.S)
BRACKET_ANSWER = re.compile(r"[（(]\s*([A-H](?:\s*[A-H]){0,5})\s*[）)]")
TRAILING_ANSWER = re.compile(r"(?<![A-Za-z])([A-H](?:\s*[A-H]){0,5})\s*$")


def clean_text(text: str) -> str:
    return text.replace("\u3000", " ").replace("\xa0", " ").strip()


def heading_kind(text: str) -> str | None:
    compact = re.sub(r"\s+", "", text)
    if len(compact) <= 24 and re.search(r"多(项)?选", compact):
        return "multiple"
    if len(compact) <= 24 and re.search(r"单(项)?选", compact):
        return "single"
    if len(compact) <= 24 and re.search(r"主观题|辨析题|简答题|论述题|材料题", compact):
        return "subjective"
    if re.fullmatch(r"第[一二三四五六七八九十]+节", compact):
        return "section"
    return None


def extract_choice(raw: dict) -> tuple[dict, list[str]]:
    lines = raw["lines"]
    first = clean_text(lines[0])
    options: list[dict[str, str]] = []
    question_lines = [first]
    warnings: list[str] = []
    for original in lines[1:]:
        line = clean_text(original)
        match = OPTION_START.match(line)
        if match:
            options.append({"label": match.group(1), "text": match.group(2).strip()})
        elif options:
            options[-1]["text"] += "\n" + line
        else:
            question_lines.append(line)

    question_raw = "\n".join(question_lines).strip()
    matches = list(BRACKET_ANSWER.finditer(question_raw))
    if matches:
        match = matches[-1]
        answer_text = match.group(1)
        question = question_raw[: match.start()] + "（ ）" + question_raw[match.end() :]
    else:
        match = TRAILING_ANSWER.search(question_raw)
        if not match:
            answer_text = ""
            question = question_raw
            warnings.append("未找到答案")
        else:
            answer_text = match.group(1)
            question = question_raw[: match.start()].rstrip() + "（ ）"

    answer = sorted(set(re.sub(r"\s+", "", answer_text)))
    labels = [option["label"] for option in options]
    if len(labels) != len(set(labels)):
        warnings.append(f"选项标签重复：{labels}")
    missing = [letter for letter in answer if letter not in labels]
    if missing:
        warnings.append(f"答案 {answer} 不在选项 {labels} 中")
    if not answer:
        warnings.append("答案为空")
    if len(options) < 2:
        warnings.append(f"选项不足：{len(options)}")
    expected_type = raw["mode"]
    actual_type = "multiple" if expected_type == "multiple" or len(answer) > 1 else "single"
    if expected_type == "single" and len(answer) > 1:
        warnings.append(f"单选标题下出现多答案：{answer}")
    if actual_type == "multiple" and len(answer) < 2:
        warnings.append("多选题答案少于两项")

    number_match = QUESTION_START.match(first)
    source_number = int(number_match.group(1)) if number_match else 0
    question = QUESTION_START.sub(lambda m: m.group(2), question, count=1).strip()
    item = {
        "kind": "choice",
        "type": actual_type,
        "chapterId": raw["chapterId"],
        "section": raw["section"],
        "sourceNumber": source_number,
        "question": question,
        "options": options,
        "answer": answer,
    }
    return item, warnings


def extract_subjective(raw: dict) -> tuple[dict, list[str]]:
    lines = [clean_text(line) for line in raw["lines"] if clean_text(line)]
    first = lines[0]
    number_match = QUESTION_START.match(first)
    source_number = int(number_match.group(1)) if number_match else 0
    question = QUESTION_START.sub(lambda m: m.group(2), first, count=1).strip()
    answer_lines = lines[1:]
    if "答：" in question or "答:" in question:
        parts = re.split(r"答[：:]", question, maxsplit=1)
        question = parts[0].strip()
        answer_lines.insert(0, parts[1].strip())
    if answer_lines:
        answer_lines[0] = re.sub(r"^答\s*[：:]\s*", "", answer_lines[0])
    answer = "\n".join(answer_lines).strip()
    warnings = []
    if not question:
        warnings.append("题干为空")
    if not answer:
        warnings.append("主观题答案为空")
    item = {
        "kind": "subjective",
        "type": "subjective",
        "chapterId": raw["chapterId"],
        "section": raw["section"],
        "sourceNumber": source_number,
        "question": question,
        "answer": answer,
    }
    return item, warnings


def parse_document(chapter_id: str, path: Path) -> tuple[list[dict], list[str]]:
    paragraphs = [clean_text(p.text) for p in Document(path).paragraphs]
    paragraphs = [text for text in paragraphs if text]
    mode = "subjective" if chapter_id == "focus" else None
    section = "重点主观题" if chapter_id == "focus" else "第一节"
    raw_items: list[dict] = []
    current: dict | None = None
    issues: list[str] = []

    def flush() -> None:
        nonlocal current
        if current:
            raw_items.append(current)
            current = None

    for index, text in enumerate(paragraphs):
        kind = heading_kind(text)
        if kind == "section":
            flush()
            section = text
            mode = None
            continue
        if kind in {"single", "multiple", "subjective"}:
            flush()
            mode = kind
            continue
        if index == 0 and not QUESTION_START.match(text):
            continue
        match = QUESTION_START.match(text)
        if match:
            flush()
            if mode is None:
                issues.append(f"第 {index + 1} 段题目前缺少题型标题：{text[:50]}")
                continue
            current = {
                "chapterId": chapter_id,
                "section": section,
                "mode": mode,
                "lines": [text],
            }
        elif current:
            current["lines"].append(text)
        elif text not in {chapter_id, "绪  论"}:
            issues.append(f"未归类段落：{text[:60]}")
    flush()

    items = []
    for raw in raw_items:
        if raw["mode"] == "subjective":
            item, warnings = extract_subjective(raw)
        else:
            item, warnings = extract_choice(raw)
        item["sourceFile"] = path.name
        items.append(item)
        issues.extend(f"{path.name} 第 {item['sourceNumber']} 题：{warning}" for warning in warnings)
    return items, issues


def normalized(text: str) -> str:
    return re.sub(r"[\s，。；：、？！‘’“”（）()《》]", "", text)


def consolidate_subjectives(items: list[dict]) -> tuple[list[dict], int]:
    groups: dict[str, list[dict]] = {}
    for item in items:
        if item["kind"] == "subjective":
            groups.setdefault(normalized(item["question"]), []).append(item)
    merged_ids = {
        id(item)
        for group in groups.values()
        if len(group) > 1
        for item in group
        if item["chapterId"] != "focus"
    }
    merged_count = 0
    result = []
    for item in items:
        if id(item) in merged_ids:
            continue
        if item["kind"] == "subjective":
            group = groups[normalized(item["question"])]
            if len(group) > 1:
                merged_count += len(group) - 1
                records = [{
                    "chapterId": source["chapterId"],
                    "section": source["section"],
                    "sourceNumber": source["sourceNumber"],
                    "sourceFile": source["sourceFile"],
                } for source in group]
                item["sourceRecords"] = records
                item["alternateAnswers"] = [{
                    "sourceFile": source["sourceFile"],
                    "answer": source["answer"],
                } for source in group if source is not item and normalized(source["answer"]) != normalized(item["answer"])]
        result.append(item)
    return result, merged_count


def build(source_dir: Path) -> tuple[dict, list[str]]:
    all_items: list[dict] = []
    all_issues: list[str] = []
    chapters = []
    for order, (chapter_id, short_title, title, filename) in enumerate(CHAPTERS):
        path = source_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"缺少源文件：{path}")
        items, issues = parse_document(chapter_id, path)
        all_items.extend(items)
        all_issues.extend(issues)
        chapters.append({
            "id": chapter_id,
            "shortTitle": short_title,
            "title": title,
            "file": filename,
            "order": order,
        })

    source_total = len(all_items)
    all_items, merged_count = consolidate_subjectives(all_items)
    choice_count = 0
    subjective_count = 0
    for order, item in enumerate(all_items):
        if item["kind"] == "choice":
            choice_count += 1
            item["id"] = f"c{choice_count:04d}"
        else:
            subjective_count += 1
            item["id"] = f"s{subjective_count:04d}"
        item["order"] = order
        item["chapterIds"] = sorted({
            record["chapterId"] for record in item.get("sourceRecords", [])
        } | {item["chapterId"]}, key=lambda value: next(i for i, c in enumerate(chapters) if c["id"] == value))

    choice_variants: dict[str, str] = {}
    for item in all_items:
        if item["kind"] != "choice":
            continue
        key = normalized(item["question"])
        if key in choice_variants:
            item["variantOf"] = choice_variants[key]
        else:
            choice_variants[key] = item["id"]

    summary = {}
    for chapter in chapters:
        chapter_items = [item for item in all_items if chapter["id"] in item["chapterIds"]]
        summary[chapter["id"]] = {
            "single": sum(item.get("type") == "single" for item in chapter_items),
            "multiple": sum(item.get("type") == "multiple" for item in chapter_items),
            "subjective": sum(item["kind"] == "subjective" for item in chapter_items),
        }
    bank = {
        "meta": {
            "title": "马原记忆舱",
            "version": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceTotal": source_total,
            "mergedDuplicates": merged_count,
            "total": len(all_items),
            "choice": choice_count,
            "subjective": subjective_count,
            "single": sum(1 for item in all_items if item.get("type") == "single"),
            "multiple": sum(1 for item in all_items if item.get("type") == "multiple"),
        },
        "chapters": chapters,
        "questions": all_items,
        "summary": summary,
    }
    return bank, all_issues


def main() -> None:
    parser = argparse.ArgumentParser(description="将九份马原 DOCX 构建为网站题库数据")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "questions.js")
    args = parser.parse_args()
    bank, issues = build(args.source)
    payload = json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
    content = (
        "(function(root){const data=" + payload + ";"
        "if(typeof module!==\"undefined\"&&module.exports){module.exports=data;}"
        "else{root.QUESTION_BANK=data;}})(typeof globalThis!==\"undefined\"?globalThis:this);\n"
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(json.dumps(bank["meta"], ensure_ascii=False, indent=2))
    print(json.dumps(bank["summary"], ensure_ascii=False, indent=2))
    if issues:
        print("\n质检问题：")
        for issue in issues:
            print("-", issue)
        raise SystemExit(1)
    print(f"\n已生成 {args.output}，全部结构与答案校验通过。")


if __name__ == "__main__":
    main()
