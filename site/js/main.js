// 入口：创建应用并启动。
import { App } from "./ui/app.js";

const app = new App();
app.boot();

// 方便调试：控制台里可以访问 window.__cgw。
window.__cgw = app;
// 导入界面不在工具栏里，需要时在控制台执行 showImport() 调出。
window.showImport = () => app.showImport();
