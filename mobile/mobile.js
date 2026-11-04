(() => {
  let exporting = false;

  async function save(blob, name) {
    const files = window.Capacitor.Plugins.StudioFiles;
    if (exporting) throw new Error('Finish the current export first.');
    exporting = true;
    let started = false;
    try {
      await files.begin();
      started = true;
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const chunk = blob.slice(offset, offset + chunkSize);
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(chunk);
        });
        await files.append({ data });
      }
      const result = await files.save({ name, mime: blob.type || 'application/octet-stream' });
      return result.saved;
    } finally {
      try {
        if (started) await files.discard();
      } finally {
        exporting = false;
      }
    }
  }

  window.StudioMobile = {
    get nativeFiles() {
      return window.Capacitor?.isPluginAvailable('StudioFiles') === true;
    },
    save,
    openGuide: () => window.Capacitor.Plugins.StudioFiles.openGuide()
  };
})();
