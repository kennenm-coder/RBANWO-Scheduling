export function buildSalesforceUrl(workOrderNumber: string): string {
  return `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${encodeURIComponent(workOrderNumber)}`;
}

export function openSalesforce(
  workOrderNumber: string,
  orderNumber: string
): void {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const webUrl = buildSalesforceUrl(workOrderNumber);

  if (isMobile) {
    navigator.clipboard?.writeText(orderNumber).catch(() => {});
    const appUrl = `salesforce1://search/${encodeURIComponent(workOrderNumber)}`;
    const start = Date.now();
    window.location.href = appUrl;
    setTimeout(() => {
      if (Date.now() - start < 1800) {
        window.open(webUrl, "_blank");
      }
    }, 1500);
  } else {
    window.open(webUrl, "_blank");
  }
}

export function mapsHref(address: string): string {
  const encoded = encodeURIComponent(address);
  if (typeof navigator === "undefined") {
    return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return `maps:?q=${encoded}`;
  if (/Android/i.test(ua)) return `geo:0,0?q=${encoded}`;
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
