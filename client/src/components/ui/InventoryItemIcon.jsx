import { Apple, Beef, Carrot, Coffee, Droplets, Milk, Package, Wheat } from "lucide-react";
import { SemanticIcon } from "./SemanticIcon.jsx";

const itemIconTypes = {
  "basmati rice": "grain", butter: "dairy", chicken: "meat", "coffee beans": "pantry",
  "cooking oil": "oil", "flour (maida)": "grain", "mango pulp": "fruit", onions: "vegetable",
  paneer: "dairy", tomatoes: "vegetable",
};

const categoryIconTypes = {
  beverages: "fruit", dairy: "dairy", grains: "grain", meat: "meat", pantry: "pantry", vegetables: "vegetable",
};

const itemTones = {
  "basmati rice": "amber", butter: "amber", chicken: "red", "coffee beans": "blue",
  "cooking oil": "red", "flour (maida)": "amber", "mango pulp": "orange", onions: "green",
  paneer: "blue", tomatoes: "green",
};

const categoryTones = {
  beverages: "pink", dairy: "blue", grains: "amber", meat: "red", pantry: "blue", vegetables: "green",
};

const icons = { dairy: Milk, fruit: Apple, grain: Wheat, meat: Beef, oil: Droplets, pantry: Coffee, vegetable: Carrot };

export function InventoryItemIcon({ category = "", name = "", size = "md" }) {
  const normalizedName = name.trim().toLowerCase();
  const normalizedCategory = category.trim().toLowerCase();
  const type = itemIconTypes[normalizedName] || categoryIconTypes[normalizedCategory] || "package";
  const tone = itemTones[normalizedName] || categoryTones[normalizedCategory] || "blue";

  return <SemanticIcon className="inventory-item-icon" icon={icons[type] || Package} semantic={name} size={size} tone={tone} />;
}
