/**
 * Shared helpers for rendering flat (2D) operational theaters.
 * Used by both the admin editor and the client viewer.
 */

/**
 * Render a flat theater's background + location markers into a viewport element.
 * @param {HTMLElement} viewport - the .theater-map-viewport container
 * @param {Object} theater - the theater object
 * @param {Object} opts - { selectedLocationId, onMarkerClick(loc), showLabels }
 */
function renderFlatTheater(viewport, theater, opts) {
  opts = opts || {};
  viewport.innerHTML = '';
  viewport.classList.remove('empty');

  if (!theater) {
    viewport.classList.add('empty');
    viewport.textContent = '> NO_THEATER_SELECTED_';
    return;
  }

  // Background image
  if (theater.backgroundImage) {
    const img = document.createElement('img');
    img.className = 'theater-map-image';
    img.src = '/theater-assets/' + encodeURIComponent(theater.backgroundImage);
    img.alt = theater.name || 'Theater';
    // If the image no longer exists (e.g. it was deleted), remove it so a
    // stale/broken image isn't shown from cache.
    img.onerror = () => { img.remove(); };
    viewport.appendChild(img);
  }

  // Markers
  (theater.locations || []).forEach(loc => {
    // Only flat-positioned locations render here
    if (typeof loc.x !== 'number' || typeof loc.y !== 'number') return;

    const marker = document.createElement('div');
    marker.className = 'theater-marker';
    if (opts.selectedLocationId && loc.id === opts.selectedLocationId) {
      marker.classList.add('selected');
    }
    marker.style.left = (loc.x * 100) + '%';
    marker.style.top = (loc.y * 100) + '%';
    marker.dataset.locationId = loc.id;

    // Render the marker icon: the emblem SVG is used as a CSS mask filled with
    // the location's color (iconColor), with a subtle neutral drop-shadow for
    // contrast on light backgrounds.
    const scale = Number(loc.iconScale) || 1;
    const size = 32 * scale;
    const iconUrl = '/emblems/' + encodeURIComponent(loc.icon || 'token--world.svg');

    const fillColor = loc.iconColor || '#e0e0e0';
    const maskValue = "url('" + iconUrl + "') no-repeat center / contain";

    const icon = document.createElement('span');
    icon.className = 'theater-marker-icon';
    icon.style.width = size + 'px';
    icon.style.height = size + 'px';
    icon.style.backgroundColor = fillColor;
    icon.style.webkitMask = maskValue;
    icon.style.mask = maskValue;
    icon.style.filter = 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.9))';

    marker.appendChild(icon);

    if (opts.showLabels !== false) {
      const label = document.createElement('div');
      label.className = 'theater-marker-label';
      label.textContent = loc.name || '';
      marker.appendChild(label);
    }

    if (typeof opts.onMarkerClick === 'function') {
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onMarkerClick(loc);
      });
    }

    viewport.appendChild(marker);
  });
}

/**
 * Convert a click event on the viewport into normalized [0,1] coordinates.
 * @param {HTMLElement} viewport
 * @param {MouseEvent} event
 * @returns {{x:number, y:number}}
 */
function viewportClickToNormalized(viewport, event) {
  const rect = viewport.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  };
}

// Expose on window for use by non-module scripts
window.TheaterShared = {
  renderFlatTheater,
  viewportClickToNormalized
};
