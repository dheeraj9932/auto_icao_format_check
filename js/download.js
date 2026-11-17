// Export the rendered output as JPEG. Browser only.

export function downloadOutput(outCanvas, fileName = 'passport_630x810.jpg') {
  outCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/jpeg', 0.92);
}
