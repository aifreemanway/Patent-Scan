"use client";

import Script from "next/script";
import { useEffect } from "react";
import { METRIKA_COUNTER_ID, reachGoal } from "@/lib/metrika";

// Яндекс.Метрика: тег + scroll-цели. Монтируется один раз в layout.
//
// Тег грузится afterInteractive — оригинальный макет передаёт в init
// referrer:document.referrer и url:location.href (рантайм-значения браузера),
// поэтому beforeInteractive не подходит. Цели на CTA проставлены через onClick
// (reachGoal из lib/metrika); здесь — только глубинные scroll-цели (50/90%),
// которые в макете висели на window scroll-листенере.
export function YandexMetrika() {
  useEffect(() => {
    let fired50 = false;
    let fired90 = false;
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      if (scrollable <= 0) return;
      const depth = (doc.scrollTop / scrollable) * 100;
      if (!fired50 && depth >= 50) {
        fired50 = true;
        reachGoal("scroll_50");
      }
      if (!fired90 && depth >= 90) {
        fired90 = true;
        reachGoal("scroll_90");
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_COUNTER_ID}","ym");ym(${METRIKA_COUNTER_ID},"init",{ssr:true,webvisor:true,clickmap:true,ecommerce:"dataLayer",accurateTrackBounce:true,trackLinks:true});`}
      </Script>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${METRIKA_COUNTER_ID}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
