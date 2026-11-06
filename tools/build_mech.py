#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析《机械工程材料》试题库（structure JSON），输出结构化题目数据。

    python tools/build_mech.py --structure jx.json --out data/mech.json

structure 由 workbuddy-pdf 生成：
    workbuddy-pdf 题库.pdf -f structure -o jx.json
"""
import argparse
import json
import re

from mech_overrides import BLANK_OVERRIDES, PATCHES

CJK_RANGE = "\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef"
CJK_RE = re.compile(f"[{CJK_RANGE}]")

SECTION_ORDER = ["term", "judge", "single", "blank", "essay", "analysis"]
SECTION_HEAD_RE = re.compile(r"^([一二三四五六])\s*[、.．]\s*")

# 题号：带分隔符（、.．）的题号一律认可
STRICT_HEAD_RE = re.compile(r"^(\d{1,3})(?:\s*[-—~]\s*\d{1,3})?\s*[、.．]\s*")
# 无分隔符（空格或直接接汉字）的题号需按顺序号校验，避免把「45 钢」当成新题
LOOSE_HEAD_RE = re.compile(r"^(\d{1,3})(?:\s*[-—~]\s*\d{1,3})?\s*(?=[\u4e00-\u9fa5A-Za-z(（])")
# 段内切分：①中文顿号题号 ②点号题号（后接汉字/字母） ③三位数题号
SPLIT_RES = [
    re.compile(r"(?<=[。】）)])\s*(?=\d{1,3}\s*、\s*\S)"),
    re.compile(r"(?<=[。】）)])\s*(?=\d{1,3}(?:\s*[-—~]\s*\d{1,3})?\s*[.．]\s*[\u4e00-\u9fa5A-Za-z(（])"),
    re.compile(r"(?<=[。】）)])\s*(?=1\d{2}\s+[\u4e00-\u9fa5])"),
]

ANSWER_PAREN_RE = re.compile(r"[（(]\s*([A-H]{1,4})\s*[）)]")
LETTER_RE = re.compile(r"(?<![A-Za-z0-9])([A-H])\s*[、.．]\s*")
LETTER_FALLBACK_RE = re.compile(r"(?<![A-Za-z0-9\uff21-\uff3a\uff41-\uff5a])([A-H])(?=[\u4e00-\u9fa5])")
VERDICT_RE = re.compile(r"[（(]\s*([╳×√✓])\s*[）)]")
CORRECTION_RE = re.compile(r"改正\s*[:：]\s*(.+)$")
UL_OPEN, UL_CLOSE = "\u27e6", "\u27e7"


def collect_paragraphs(structure):
    out = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "paragraph":
                out.append(node)
            for key, value in node.items():
                if key != "runs":
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for section in structure["sections"]:
        start = len(out)
        walk(section["blocks"])
        for para in out[start:]:
            para["_page"] = section["index"] + 1
    return out


def clean(text):
    text = text.replace("\u00a0", " ").replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text).strip()
    previous = None
    while previous != text:
        previous = text
        text = re.sub(f"(?<=[{CJK_RANGE}]) (?=[{CJK_RANGE}])", "", text)
        text = re.sub(f"(?<=[{CJK_RANGE}]) (?=[,.;:!?()、。，；：！？（）《》“”])", "", text)
        text = re.sub(f"(?<=[,.;:!?()、。，；：！？（）《》“”]) (?=[{CJK_RANGE}])", "", text)
        text = re.sub(r"(?<=\d) (?=[\d%.])", "", text)
        text = re.sub(r"(?<=[\d%]) (?=\d)", "", text)
    return text


def is_header(text):
    return ("试题库及答案" in text and "解析" in text) or bool(re.match(r"^第\s*\d+\s*页\s*/\s*共", text))


def marked_text(para):
    """段落文本，下划线片段用 ⟦⟧ 包裹。"""
    pieces = []
    for run in para.get("runs") or []:
        text = run.get("text", "")
        if run.get("underline") and text.strip():
            pieces.append(UL_OPEN + text + UL_CLOSE)
        else:
            pieces.append(text)
    if not pieces:
        return para.get("text", "")
    return "".join(pieces)


def section_lines(paragraphs):
    """把一个大题下的段落按题目切分：段内按「、.．」切，段首允许「25 纤维组织」这种空格式题号。"""
    lines = []
    for para in paragraphs:
        text = marked_text(para).replace("\n", " ").strip()
        if not text or is_header(text):
            continue
        for pattern in SPLIT_RES:
            text = pattern.sub("\n", text)
        lines.extend(piece.strip() for piece in text.split("\n") if piece.strip())
    return lines


def group_items(paragraphs):
    """[{num, text}]，text 为带下划线标记的整题文本。"""
    items = []
    for line in section_lines(paragraphs):
        line = line.strip()
        if not line:
            continue
        match = STRICT_HEAD_RE.match(line)
        if not match:
            loose = LOOSE_HEAD_RE.match(line)
            if loose:
                last = items[-1]["num"] if items else 0
                if int(loose.group(1)) == last + 1:
                    match = loose
        if match:
            items.append({"num": int(match.group(1)), "text": line[match.end():].strip()})
        elif items:
            items[-1]["text"] += " " + line
        else:
            items.append({"num": 0, "text": line})
    return items


def split_explanation(text):
    """拆分题干 / 解析 / 勘误（勘误可能出现在解析之前或之后）。"""
    body = text
    explain = ""
    erratum = ""
    index = body.find("【解析】")
    if index >= 0:
        explain = body[index + 4:].strip()
        body = body[:index].strip()
    index = body.find("【勘误】")
    if index >= 0:
        erratum = body[index + 4:].strip()
        body = body[:index].strip()
    index = explain.find("【勘误】")
    if index >= 0:
        erratum = (erratum + " " + explain[index + 4:]).strip()
        explain = explain[:index].strip()
    return clean(body), clean(explain), clean(erratum)


def count_option_marks(text):
    letters = LETTER_RE.findall(text)
    if len(letters) >= 2:
        return len(letters)
    return len(LETTER_FALLBACK_RE.findall(text))


def split_options(text):
    """把 "A、… B、…" 拆成选项数组。"""
    marks = list(LETTER_RE.finditer(text))
    if len(marks) < 2:
        marks = list(LETTER_FALLBACK_RE.finditer(text))
    if len(marks) < 2:
        return [], text
    expected = [chr(65 + i) for i in range(len(marks))]
    letters = [m.group(1) for m in marks]
    options = []
    for position, mark in enumerate(marks):
        end = marks[position + 1].start() if position + 1 < len(marks) else len(text)
        options.append({"label": letters[position], "text": clean(text[mark.end():end]).strip("；;，, ")})
    tail = text[marks[0].start():]
    stem_extra = text[:marks[0].start()]
    return options, stem_extra


def parse_term(items):
    rows = []
    for item in items:
        body, explain, erratum = split_explanation(item["text"])
        body = body.replace("：", "：")
        if "：" not in body and ":" in body:
            body = body.replace(":", "：", 1)
        if "：" not in body:
            continue
        term, definition = body.split("：", 1)
        rows.append({
            "num": item["num"],
            "term": clean(term),
            "definition": clean(definition),
            "explanation": explain,
            "erratum": erratum,
        })
    return rows


def parse_judge(items):
    rows = []
    for item in items:
        body, explain, erratum = split_explanation(item["text"])
        match = VERDICT_RE.search(body)
        if not match:
            continue
        stem = (body[:match.start()] + body[match.end():]).strip()
        correction = ""
        fix = CORRECTION_RE.search(stem)
        if fix:
            correction = clean(fix.group(1)).rstrip("。")
            stem = stem[:fix.start()].strip()
        rows.append({
            "num": item["num"],
            "stem": clean(stem),
            "answer": "A" if match.group(1) in "√✓" else "B",
            "correction": correction,
            "explanation": explain,
            "erratum": erratum,
        })
    return rows


def parse_single(items):
    rows = []
    for item in items:
        body, explain, erratum = split_explanation(item["text"])
        answers = list(ANSWER_PAREN_RE.finditer(body))
        chosen = None
        for candidate in answers:
            after = body[candidate.end():]
            if count_option_marks(after) >= 2:
                chosen = candidate
                break
        if not chosen:
            continue
        options, middle = split_options(body[chosen.end():])
        pre = body[:chosen.start()]
        stem = clean(pre + "（　）" + middle).strip()
        labels = [option["label"] for option in options]
        answer = [letter for letter in chosen.group(1) if letter in labels]
        rows.append({
            "num": item["num"],
            "stem": stem,
            "options": options,
            "answer": answer,
            "rawAnswer": chosen.group(1),
            "explanation": explain,
            "erratum": erratum,
        })
    return rows


def parse_blank(items):
    rows = []
    for item in items:
        body, explain, erratum = split_explanation(item["text"])
        blanks = []
        question = []
        index = 0
        while index < len(body):
            if body[index] == UL_OPEN:
                end = body.find(UL_CLOSE, index)
                if end < 0:
                    question.append(body[index + 1:])
                    break
                value = clean(body[index + 1:end])
                blanks.append(value)
                question.append(f"（{len(blanks)}）＿＿＿＿")
                index = end + 1
            else:
                question.append(body[index])
                index += 1
        text = clean("".join(question))
        literal = text.count("＿＿＿＿")
        rows.append({
            "num": item["num"],
            "question": text,
            "blanks": blanks,
            "literalBlanks": literal,
            "explanation": explain,
            "erratum": erratum,
        })
    return rows


def parse_essay(items, kind="essay"):
    rows = []
    for item in items:
        body, explain, erratum = split_explanation(item["text"])
        answer = ""
        question = body
        for marker in ("答：", "答:", "答；"):
            index = body.find(marker)
            if index >= 0:
                question = body[:index]
                answer = body[index + len(marker):]
                break
        rows.append({
            "num": item["num"],
            "question": clean(question),
            "answer": clean(answer),
            "explanation": explain,
            "erratum": erratum,
        })
    return rows


# ---------------------------------------------------------------- 章节归属
CHAPTERS = [
    ("perf", "力学性能", "强度、塑性、硬度、韧性与疲劳", 0),
    ("crystal", "晶体结构与结晶", "晶格、缺陷、结晶与塑性变形", 1),
    ("phase", "铁碳相图与组织", "相、组织、Fe-Fe₃C 相图与转变", 2),
    ("heat", "钢的热处理", "退火、正火、淬火、回火与表面处理", 3),
    ("steel", "工业用钢", "结构钢、工具钢、不锈钢与牌号", 4),
    ("iron", "铸铁与有色金属", "石墨化、球铁、铝合金与轴承合金", 5),
    ("nonmetal", "非金属与选材", "高分子、陶瓷、复合材料与失效选材", 6),
]

KEYWORDS = {
    "perf": ["强度", "塑性", "硬度", "韧性", "疲劳", "冲击", "刚度", "弹性极限", "屈服", "伸长率", "断面收缩",
             "σ", "HBW", "HRC", "Ak", "αk", "失效", "磨损", "弹性模量"],
    "crystal": ["晶格", "晶粒", "位错", "滑移", "孪生", "结晶", "过冷度", "形核", "固溶体", "固溶强化", "间隙",
                "置换", "缺陷", "空位", "晶界", "各向异性", "同素异构", "再结晶", "加工硬化", "纤维组织",
                "铸锭", "柱状晶", "弥散强化", "细晶强化", "形变强化", "冷作强化", "相图"],
    "phase": ["渗碳体", "珠光体", "奥氏体", "铁素体", "莱氏体", "贝氏体", "马氏体", "共析", "共晶", "相组成", "相变", "相",
              "Fe3C", "Fe-Fe3C", "含碳量", "碳当量", "网状", "球化", "组织组成物", "二次渗碳体", "残余奥氏体"],
    "heat": ["退火", "正火", "淬火", "回火", "淬透性", "淬硬性", "临界冷却速度", "C 曲线", "CCT", "Vk", "调质",
             "渗碳", "氮化", "表面淬火", "感应加热", "分级淬火", "等温淬火", "水韧", "固溶处理", "时效",
             "冷处理", "回火脆性", "热硬性", "二次硬化", "淬火裂纹", "加热温度"],
    "steel": ["Q235", "Q345", "45 钢", "40Cr", "20CrMnTi", "T8", "T10", "T12", "GCr15", "W18Cr4V", "9SiCr",
              "Cr12MoV", "CrWMn", "1Cr18Ni9Ti", "1Cr13", "ZGMn13", "16Mn", "60Si2Mn", "40CrNiMo", "38CrMoAl",
              "Ni18Cr9Ti", "渗氮钢", "不锈钢", "耐热钢", "弹簧钢", "轴承钢", "刃具钢", "模具钢", "调质钢", "渗碳钢", "牌号", "合金钢",
              "碳素钢", "工具钢", "结构钢", "硬质合金", "YT15", "YG3"],
    "iron": ["铸铁", "石墨", "球墨", "可锻", "灰口", "白口", "HT", "QT", "蠕墨", "铝合金", "硬铝", "防锈铝",
             "铜合金", "黄铜", "青铜", "轴承合金", "巴氏合金", "钛合金", "镁合金", "有色金属"],
    "nonmetal": ["塑料", "陶瓷", "复合材料", "橡胶", "高分子", "热塑性", "热固性", "选材", "工艺路线", "失效形式",
                 "气孔", "玻璃"],
}


def classify(question, extra=""):
    """按题干为主、答案与解析为辅的加权打分归类章节。

    题干命中权重 3，其余文本命中权重 1；这样“珠光体”“固溶强化”这类
    题干短、但答案里出现大量性能术语的题目不会被误判到力学性能章。
    """
    scores = {key: 0 for key, *_ in CHAPTERS}
    for key, words in KEYWORDS.items():
        bonus = 0
        for word in words:
            if word in question:
                scores[key] += 3
            elif extra and word in extra:
                bonus += 1
        # 附属文本只作辅助，最多加 2 分，避免长答案里的高频词主导归类
        scores[key] += min(2, bonus)
    top = max(scores.values())
    if top == 0:
        return "perf"
    for key, *_ in CHAPTERS:
        if scores[key] == top:
            return key
    return "perf"


def build(structure):
    paragraphs = collect_paragraphs(structure)
    marks = []
    for index, para in enumerate(paragraphs):
        match = SECTION_HEAD_RE.match(para["text"].strip())
        if match:
            marks.append((index, SECTION_ORDER["一二三四五六".index(match.group(1))]))
    groups = {}
    for position, (index, key) in enumerate(marks):
        end = marks[position + 1][0] if position + 1 < len(marks) else len(paragraphs)
        groups[key] = paragraphs[index + 1:end]

    questions = []
    counter = 0

    seen_keys = {}

    def add(item):
        nonlocal counter
        key = f"{item.pop('_skey')}:{item['sourceNumber']}"
        seen_keys[key] = seen_keys.get(key, 0) + 1
        patch = PATCHES.get(key)
        if seen_keys[key] > 1:
            patch = PATCHES.get(f"{key}#{seen_keys[key]}") or patch
        if patch and patch.get("delete"):
            return
        if item.get("type") == "blank" and item["sourceNumber"] in BLANK_OVERRIDES:
            question, answers = BLANK_OVERRIDES[item["sourceNumber"]]
            item["question"] = question
            item["blanks"] = answers
            item["answer"] = "；".join(answers)
        if patch:
            for field, value in patch.items():
                if field != "delete":
                    item[field] = value
            if "answer" in patch:
                item["_patchedAnswer"] = True
        counter += 1
        item["id"] = f"j{counter:04d}"
        item["order"] = counter - 1
        stem = " ".join(str(item.get(key, "")) for key in ("question", "term"))
        chapter = classify(stem, str(item.get("_text", "")))
        item["chapterId"] = chapter
        item["chapterIds"] = [chapter]
        item.pop("_text", None)
        questions.append(item)

    for row in parse_term(group_items(groups["term"])):
        add({
            "kind": "term", "type": "term", "section": "名词解释", "_skey": "term",
            "question": row["term"], "answer": row["definition"],
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["definition"],
        })

    for row in parse_judge(group_items(groups["judge"])):
        add({
            "kind": "judge", "type": "tf", "section": "判断正误", "_skey": "judge",
            "question": row["stem"],
            "options": [{"label": "A", "text": "说法正确"}, {"label": "B", "text": "说法错误"}],
            "answer": [row["answer"]],
            "correction": row["correction"],
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["stem"],
        })

    for row in parse_single(group_items(groups["single"])):
        add({
            "kind": "choice", "type": "single", "section": "单项选择", "_skey": "single",
            "question": row["stem"], "options": row["options"], "answer": row["answer"],
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["stem"],
        })

    for row in parse_blank(group_items(groups["blank"])):
        add({
            "kind": "blank", "type": "blank", "section": "填空题", "_skey": "blank",
            "question": row["question"], "blanks": row["blanks"],
            "answer": "；".join(row["blanks"]),
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["question"],
        })

    for row in parse_essay(group_items(groups["essay"])):
        add({
            "kind": "subjective", "type": "essay", "section": "简答题", "_skey": "essay",
            "question": row["question"], "answer": row["answer"],
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["question"],
        })

    for row in parse_essay(group_items(groups["analysis"])):
        add({
            "kind": "subjective", "type": "analysis", "section": "综合分析", "_skey": "analysis",
            "question": row["question"], "answer": row["answer"],
            "explanation": row["explanation"], "erratum": row["erratum"],
            "sourceNumber": row["num"], "_text": row["question"],
        })

    # 依据【勘误】自动修正答案（人工补丁优先）
    for question in questions:
        patched = question.pop("_patchedAnswer", False)
        erratum = question.get("erratum") or ""
        if not erratum or patched:
            continue
        if question["type"] in ("single", "multiple"):
            match = re.search(r"正确答案(?:应|宜)?为\s*([A-H])", erratum)
            if match:
                question["answer"] = [match.group(1)]
                question["answerCorrected"] = True
        elif question["type"] == "tf":
            match = re.search(r"(?:本题)?答案应改为\s*([╳×√✓])", erratum) or re.search(r"建议(?:改)?为\s*([╳×√✓])", erratum)
            if match:
                question["answer"] = ["A" if match.group(1) in "√✓" else "B"]
                question["answerCorrected"] = True

    for question in questions:
        question["sourceFile"] = "机械工程材料试题库（勘误版）"

    counts = {}
    for question in questions:
        counts[question["type"]] = counts.get(question["type"], 0) + 1
    chapters = [
        {"id": key, "shortTitle": title, "title": desc, "file": "机械工程材料", "order": order}
        for key, title, desc, order in CHAPTERS
    ]
    summary = {
        chapter["id"]: {"single": 0, "multiple": 0, "tf": 0, "blank": 0, "term": 0, "essay": 0, "analysis": 0}
        for chapter in chapters
    }
    for question in questions:
        summary[question["chapterId"]][question["type"]] += 1
    return {
        "meta": {
            "title": "机械工程材料", "subject": "机械工程材料",
            "total": len(questions), "counts": counts,
            "source": "《机械工程材料》试题库及答案（含详细解析·勘误版）",
        },
        "chapters": chapters,
        "summary": summary,
        "questions": questions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--structure", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dump")
    parser.add_argument("--js")
    args = parser.parse_args()
    with open(args.structure, encoding="utf-8") as handle:
        structure = json.load(handle)
    bank = build(structure)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(bank, handle, ensure_ascii=False, indent=1)
    print(f"题库：{bank['meta']['total']} 题 {bank['meta']['counts']}")
    if args.js:
        payload = json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
        with open(args.js, "w", encoding="utf-8") as handle:
            handle.write(
                "(function(root){const data=" + payload + ";"
                "if(typeof module!==\"undefined\"&&module.exports){module.exports=data;}"
                "else{root.QUESTION_BANK_MECH=data;}})(typeof globalThis!==\"undefined\"?globalThis:this);\n"
            )
    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as handle:
            for question in bank["questions"]:
                handle.write(f"## {question['id']} [{question['type']}][{question['chapterId']}] #{question['sourceNumber']}\n")
                handle.write(f"Q: {question['question']}\n")
                if question.get("options"):
                    handle.write("OPT: " + " | ".join(
                        f"{option['label']}.{option['text']}" for option in question["options"]) + "\n")
                handle.write(f"A: {question.get('answer')}\n")
                if question.get("blanks"):
                    handle.write(f"BLANKS: {question['blanks']}\n")
                handle.write(f"EX: {question.get('explanation','')[:160]}\n")
                if question.get("erratum"):
                    handle.write(f"ERR: {question['erratum'][:120]}\n")
                handle.write("\n")


if __name__ == "__main__":
    main()
