"use client";
import React from "react";

/** Renderizador de markdown minimalista (headings, listas, negrito, parágrafos). */
export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: string) => {
    if (list.length) {
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-1 my-2">
          {list.map((item, i) => (
            <li key={`${key}-item-${i}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushList(`l-${i}`);
      return;
    }
    if (line.startsWith("## ")) {
      flushList(`l-${i}`);
      blocks.push(
        <h3 key={`h3-${i}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1">
          {renderInline(line.slice(3))}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      flushList(`l-${i}`);
      blocks.push(
        <h2 key={`h2-${i}`} className="text-base font-bold mt-4 mb-1">
          {renderInline(line.slice(2))}
        </h2>
      );
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (/^\d+\.\s+/.test(line)) {
      blocks.push(
        <p key={`p-num-${i}`} className="my-1">
          {renderInline(line)}
        </p>
      );
    } else {
      flushList(`l-${i}`);
      blocks.push(
        <p key={`p-${i}`} className="my-1.5 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  });
  flushList("last");

  return <div className="text-sm">{blocks}</div>;
}

function renderInline(text: string): React.ReactNode {
  // negrito **texto**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={`bold-${i}`}>{p.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`inline-${i}`}>{p}</React.Fragment>;
  });
}
