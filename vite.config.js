import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // GitHub Pages의 하위 경로(예: username.github.io/저장소명/)에서도 동작하도록 상대경로 사용
});
