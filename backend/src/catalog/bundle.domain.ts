export interface ComponentRequirement {
  productId: string;
  role: string;
  quantityPerBundle: number;
}

export function expandBundle(quantity: number, components: readonly ComponentRequirement[]) {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error('Bundle quantity must be positive');
  const roles = new Set<string>();
  return components.map((component) => {
    if (component.quantityPerBundle <= 0) throw new Error('Component quantity must be positive');
    if (roles.has(component.role)) throw new Error(`Duplicate component role: ${component.role}`);
    roles.add(component.role);
    return {
      productId: component.productId,
      role: component.role,
      requiredQuantity: quantity * component.quantityPerBundle,
    };
  });
}
