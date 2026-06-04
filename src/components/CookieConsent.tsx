"use client";

// Информационный cookie-баннер. Появляется один раз, до согласия; «Принять»
// запоминается в localStorage. НЕ гейтит аналитику (Метрика грузится сразу) —
// для РФ-беты достаточно уведомления + согласие зафиксировано в §10 политики.
// При запуске платной рекламы (Яндекс.Директ/ремаркетинг) можно усилить до
// consent-гейта (грузить рекламные теги только после «Принять»).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const STORAGE_KEY = "ps-cookie-consent";

export function CookieConsent() {
  const t = useTranslations("CookieConsent");
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      /* localStorage недоступен (приватный режим) — баннер просто не показываем */
    }
  }, []);

  if (!show) return null;

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* no-op */
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t("aria")}
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 60,
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15,23,42,0.12)",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#475569",
      }}
    >
      <p style={{ flex: "1 1 320px", margin: 0 }}>
        {t("text")}{" "}
        <Link href="/privacy" style={{ color: "#2563eb", textDecoration: "underline" }}>
          {t("link")}
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={accept}
        style={{
          flexShrink: 0,
          padding: "9px 22px",
          background: "#2563eb",
          color: "#ffffff",
          border: "none",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {t("accept")}
      </button>
    </div>
  );
}
