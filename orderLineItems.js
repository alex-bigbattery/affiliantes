/** Product line items from Zoho sales_orders raw_json (excludes shipping / kit components). */
export function productLineItems(items) {
  if (!Array.isArray(items)) return []
  return items.filter(li =>
    li?.name !== 'Shipping Charge'
    && li?.line_item_type !== 'service'
    && !li?.is_component)
}

export function enrichOrderLineItems(lineItems) {
  const products = productLineItems(lineItems)
  const items_sold = products.reduce((s, li) => s + Number(li.quantity || 0), 0)
  const net_sales = Math.round(
    products.reduce((s, li) => s + Number(li.item_total || 0), 0) * 100,
  ) / 100
  const products_text = products.map(li => {
    const label = li.group_name && li.group_name !== li.name ? li.group_name : (li.name || li.sku || 'Item')
    return `${li.quantity}× ${label}`
  }).join(', ')
  return { items_sold, net_sales, products_text }
}
