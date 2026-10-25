/**
 * 流式引用校验：模型给出的 [n] 编号必须落在本次召回的 1..total 之内。
 *
 * 越界编号直接从回答里删掉，而不是留给页面渲染成一个点不动的死链。
 * 因为回答是流式的，可能分片在「[1」处断开，所以要先缓冲、等下一片 token 再判。
 */

const CITATION_PATTERN = /\[(\d+)\]/g;

/** 缓冲上限：正文里出现一个孤立 '[' 时不能把它永远扣住 */
const MAX_PENDING = 16;

export interface CitationStreamFilter {
  /** 返回可安全下发的文本（越界编号已剔除） */
  push(text: string): string;
  /** 流结束时吐出缓冲里剩下的内容 */
  flush(): string;
  /** 本次作答实际引用了哪些编号、剔除了哪些 */
  report(): { referenced: number[]; dropped: number[] };
}

/**
 * 创建一个流式引用校验器。
 * @param total 本次召回的引用条数，编号必须落在 1..total
 */
export function createCitationFilter(total: number): CitationStreamFilter {
  let pending = '';
  const referenced: number[] = [];
  const dropped: number[] = [];

  const record = (list: number[], value: number) => {
    if (!list.includes(value)) list.push(value);
  };

  /** 消费缓冲：能定性的片段直接下发/丢弃，剩下可能没拼完的尾部落回缓冲 */
  const drain = (): string => {
    let out = '';
    let i = 0;

    while (i < pending.length) {
      const char = pending[i];

      if (char !== '[') {
        out += char;
        i += 1;
        continue;
      }

      const close = pending.indexOf(']', i);
      if (close === -1) break; // 可能是没拼完的编号，等下一片

      const inner = pending.slice(i + 1, close);
      if (/^\d+$/.test(inner)) {
        const index = Number(inner);
        if (index >= 1 && index <= total) {
          out += pending.slice(i, close + 1);
          record(referenced, index);
        } else {
          record(dropped, index); // 越界编号：整段丢掉，不留死链
        }
        i = close + 1;
        continue;
      }

      out += char; // 不是编号的方括号，原样输出
      i += 1;
    }

    pending = pending.slice(i);
    if (pending.length > MAX_PENDING) {
      out += pending;
      pending = '';
    }
    return out;
  };

  return {
    push(text: string): string {
      pending += text;
      return drain();
    },
    flush(): string {
      const rest = pending;
      pending = '';
      if (!rest) return '';

      CITATION_PATTERN.lastIndex = 0;
      return rest.replace(CITATION_PATTERN, (whole, digits: string) => {
        const index = Number(digits);
        if (index >= 1 && index <= total) {
          record(referenced, index);
          return whole;
        }
        record(dropped, index);
        return '';
      });
    },
    report() {
      return {
        referenced: [...referenced].sort((a, b) => a - b),
        dropped: [...dropped].sort((a, b) => a - b),
      };
    },
  };
}