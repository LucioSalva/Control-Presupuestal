// alerts.js
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];  // Importado de script.js para consistencia
const money = (v) => {
  if (v === '' || v === null || isNaN(v)) return '—';
  return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });
};

// Función para verificar si la partida con el monto existe en otros meses
async function checkPartidaConflict(project, partida, monto) {
  try {
    const response = await fetch(`http://localhost:3000/api/check-partida?project=${encodeURIComponent(project)}&partida=${encodeURIComponent(partida)}&monto=${encodeURIComponent(monto)}`);
    if (!response.ok) throw new Error('Error en la verificación');
    const data = await response.json();  // Devuelve un array de { month, year }
    return data;  // Ej: [{ month: 1, year: 2023 }, { month: 10, year: 2023 }]
  } catch (error) {
    console.error('Error al verificar partida:', error);
    return [];  // Retorna vacío en caso de error
  }
}

// Función para mostrar la alerta de conflicto
async function showConflictAlert(conflicts) {
  if (conflicts.length === 0) return true;  // No hay conflictos, continuar

  const months = conflicts.map(c => `${MES[Math.floor(c.month) - 1]} ${c.year}`);  // Formatea los meses
  const message = `La partida con monto ${money(conflicts[0].monto)} ya existe en los meses: ${months.join(', ')}. ¿Deseas continuar?`;

  const result = await Swal.fire({
    title: 'Alerta de Conflicto',
    html: message,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, continuar',
    cancelButtonText: 'Cancelar',
    background: '#1a1a1a',
    color: '#ffffff',
  });

  return result.isConfirmed;  // Retorna true si el usuario confirma
}

// Exponemos las funciones para que script.js las use
window.checkPartidaConflict = checkPartidaConflict;
window.showConflictAlert = showConflictAlert;