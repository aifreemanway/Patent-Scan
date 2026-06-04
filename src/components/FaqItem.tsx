"use client";

import { useRef } from "react";
import { reachGoal } from "@/lib/metrika";

type FaqItemProps = {
  question: string;
  /** HTML-ответ (верстка из макета: <p>/<strong>). Доверенный контент копии. */
  answerHtml: string;
};

// Один пункт FAQ. Нативный <details> (раскрытие без JS), цель faq_opened шлём
// один раз при первом открытии. answerHtml рендерится как есть — это наша копия
// из макета (PRESERVE форматирования), не пользовательский ввод.
export function FaqItem({ question, answerHtml }: FaqItemProps) {
  const fired = useRef(false);
  return (
    <details
      className="faq-item"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !fired.current) {
          fired.current = true;
          reachGoal("faq_opened");
        }
      }}
    >
      <summary>{question}</summary>
      <div className="faq-body" dangerouslySetInnerHTML={{ __html: answerHtml }} />
    </details>
  );
}
