import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initAnalytics } from "./analytics.js";

createRoot(document.getElementById("root")).render(<App />);
initAnalytics();
