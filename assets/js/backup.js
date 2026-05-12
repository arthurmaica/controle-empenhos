export function exportBackup(db) {
  const blob = new Blob([JSON.stringify(db, null, 2)], {
    type: 'application/json'
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backup.json';
  a.click();
}