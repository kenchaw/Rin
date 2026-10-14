import i18n from "i18next";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";
import { listenSystemMode } from "../utils/darkModeUtils";

let bootstrapped = false;

export function bootstrapApp() {
  if (bootstrapped) {
    return;
  }

  listenSystemMode();

  i18n
    .use(Backend)
    .use(initReactI18next)
    .init({
      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
      lng: "en",
      fallbackLng: "en",
      interpolation: {
        escapeValue: false,
      },
    });

  bootstrapped = true;
}
