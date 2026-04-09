import { useState } from "react";
import Dashboard from "./Dashboard";
import Bodega from "./Bodega";
import Menus from "./Menus";
import Deliveries from "./Deliveries";
import ControlIngresoGasto from "./ControlIngresoGasto";
import "./Navigator.css";

const TABS = [
  { key: "dashboard", label: "📊 Dashboard", component: Dashboard },
  { key: "bodega", label: "📦 Bodega", component: Bodega },
  { key: "menus", label: "🍽️ Menús", component: Menus },
  { key: "deliveries", label: "🚚 Deliveries", component: Deliveries },
  {
    key: "control",
    label: "💰 Control de Ingreso y Gasto",
    component: ControlIngresoGasto,
  },
];

function Navigator() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const ActiveComponent =
    TABS.find((t) => t.key === activeTab)?.component || Dashboard;

  return (
    <div className="navigator-layout">
      <nav className="navigator-sidebar">
        <div className="nav-logo">🔧 Rita Control</div>
        <ul className="nav-tabs">
          {TABS.map((tab) => (
            <li
              key={tab.key}
              className={`nav-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </li>
          ))}
        </ul>
      </nav>
      <main className="navigator-content">
        <ActiveComponent />
      </main>
    </div>
  );
}

export default Navigator;
