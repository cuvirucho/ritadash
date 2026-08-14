import { useState } from "react";
import Bodega from "./Bodega";
import Menus from "./Menus";
import Deliveries from "./Deliveries";
import ControlNegocio from "./ControlNegocio";
import "./Navigator.css";
import Compras from "./Compras";

const TABS = [
  { key: "menus", label: "🍽️ Menús", component: Menus },
  { key: "deliveries", label: "🚚 Deliveries", component: Deliveries },
  { key: "bodega", label: "📦 Bodega", component: Bodega },
  { key: "compras", label: "🛒 Compras", component: Compras },
  {
    key: "negocio",
    label: "📊 Control del Negocio",
    component: ControlNegocio,
  },
];

function Navigator() {
  const [activeTab, setActiveTab] = useState("menus");

  const ActiveComponent =
    TABS.find((t) => t.key === activeTab)?.component || Menus;

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
        {activeTab === "negocio" ? (
          <ActiveComponent onClose={() => setActiveTab("menus")} />
        ) : (
          <ActiveComponent />
        )}
      </main>
    </div>
  );
}

export default Navigator;
