/**
 * 全部提示词模板，集中一处，避免散落导致行为不一致。
 */

import type { Chunk } from './model';

/** 问答系统提示词：硬约束写在提示词层面，不靠模型自觉 */
export const QA_SYSTEM_PROMPT = `你是文档问答助手。严格遵守以下规则：
1. 只依据【参考资料】回答，不得使用资料之外的知识，不得推测。
2. 资料不足以回答时，直接说「提供的资料中没有相关内容」，不要编造。
3. 每个事实性陈述的句尾必须标注来源编号，格式如 [1]、[2]，可多个如 [1][3]。
4. 引用编号必须来自【参考资料】中真实存在的编号，不得虚构编号。
5. 用简洁的中文回答，先给结论再给依据，不要重复问题。
6. 不确定的地方明确说「资料未明确说明」。`;

/** 把召回结果拼成带编号与来源的参考资料块 */
export function buildContextBlock(chunks: Chunk[]): string {
  return chunks
    .map((chunk, i) => `[${i + 1}] （来源：${chunk.docName} 第 ${chunk.page} 页）\n${chunk.text.trim()}`)
    .join('\n\n');
}

export function buildQaUserPrompt(question: string, context: string): string {
  return `【参考资料】\n${context}\n\n【问题】\n${question}`;
}

/** 检索没有命中任何资料时的固定回复，避免白白调用模型 */
export const NO_CONTEXT_ANSWER = '提供的资料中没有相关内容。可以换个说法再问，或先上传更相关的文档。';