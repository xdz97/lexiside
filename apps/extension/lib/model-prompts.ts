import type { SelectionContext } from '@lexiside/shared';

const jsonContract = `{
  "translation": "中文翻译",
  "contextExplanation": "简短的上下文解释",
  "words": [{
    "text": "原文词形",
    "lemma": "规范词形",
    "partOfSpeech": "英文词性",
    "phonetic": "/音标/",
    "meaningZh": "本文中文含义",
    "definitionEn": "简短英文释义",
    "meaningInContext": "在本文中的作用",
    "collocations": ["搭配"],
    "confidence": 0.0
  }],
  "phrases": [{
    "text": "表达",
    "meaningZh": "中文含义",
    "usage": "使用说明",
    "confidence": 0.0
  }],
  "patterns": [{
    "text": "可迁移句型",
    "explanationZh": "中文解释",
    "confidence": 0.0
  }]
}`;

export function analysisPrompt(context: SelectionContext): string {
  return `你是英语阅读学习助手。分析完整的所在句，只提炼真正值得长期积累的单词、固定表达和可迁移用法。

严格要求：
1. 不调用任何工具，不访问网页或文件。
2. 只输出一个合法 JSON 对象，不使用 Markdown，不添加说明文字。
3. 最多返回 3 个单词、3 个表达、2 个句型；不够时返回空数组。
4. 排除冠词、代词、基础介词、专有名词、代码标识符、残片和低置信度候选。
5. 所有解释必须针对当前语境，confidence 必须是 0 到 1 的数字。
6. 不猜测上下文中不存在的信息。

输出契约：
${jsonContract}

输入：
所在句：${JSON.stringify(context.sentence)}
前一句：${JSON.stringify(context.contextBefore)}
后一句：${JSON.stringify(context.contextAfter)}
页面标题：${JSON.stringify(context.pageTitle)}
来源域名：${JSON.stringify(context.siteName)}`;
}

export function translationPrompt(text: string): string {
  return `将下面英文准确、自然地翻译成简体中文。不要调用工具。只返回形如 {"translation":"..."} 的合法 JSON，不要输出 Markdown或其他文字。\n\n英文：${JSON.stringify(text)}`;
}
