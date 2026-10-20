/**
 * Mapping Storage Module
 * Handles import/export and cross-browser storage of stream-to-node mappings
 * Can store mappings in .ncft project files or export/import as JSON
 */

export class MappingStorage {
  constructor(filename = null) {
    this.filename = filename; // Associated .ncft filename
    this.storageKey = `noisecraftMappings_${filename || 'default'}`;
  }

  /**
   * Load mappings from localStorage (local storage)
   */
  loadFromLocalStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load mappings from localStorage:', e);
    }
    return [];
  }

  /**
   * Save mappings to localStorage (local storage)
   */
  saveToLocalStorage(mappings) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(mappings));
      return true;
    } catch (e) {
      console.error('Failed to save mappings to localStorage:', e);
      return false;
    }
  }

  /**
   * Load mappings from .ncft project file
   * @param {String|Object} projectData - JSON string or parsed object of .ncft file
   * @returns {Array} Array of mappings
   */
  loadFromProjectFile(projectData) {
    try {
      const project = typeof projectData === 'string' 
        ? JSON.parse(projectData) 
        : projectData;
      
      // Check if mappings are stored in project metadata
      if (project.metadata && project.metadata.streamMappings) {
        return project.metadata.streamMappings;
      }
      
      // Alternative: check for custom field
      if (project.streamMappings) {
        return project.streamMappings;
      }
    } catch (e) {
      console.warn('Failed to load mappings from project file:', e);
    }
    return [];
  }

  /**
   * Save mappings to .ncft project file structure
   * @param {Object|String} projectData - Current project data
   * @param {Array} mappings - Mappings to save
   * @returns {Object} Updated project data with mappings embedded
   */
  saveToProjectFile(projectData, mappings) {
    try {
      const project = typeof projectData === 'string' 
        ? JSON.parse(projectData) 
        : JSON.parse(JSON.stringify(projectData)); // Deep copy
      
      // Store in metadata field (non-intrusive, won't break NoiseCraft)
      if (!project.metadata) {
        project.metadata = {};
      }
      project.metadata.streamMappings = mappings;
      project.metadata.streamMappingsVersion = '1.0';
      project.metadata.streamMappingsUpdated = new Date().toISOString();
      
      return project;
    } catch (e) {
      console.error('Failed to save mappings to project file:', e);
      return projectData;
    }
  }

  /**
   * Export mappings as JSON file (download)
   * @param {Array} mappings - Mappings to export
   * @param {String} filename - Suggested filename
   */
  exportAsJSON(mappings, filename = 'noisecraft-mappings.json') {
    try {
      const dataStr = JSON.stringify(mappings, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error('Failed to export mappings:', e);
      return false;
    }
  }

  /**
   * Import mappings from JSON file (file input)
   * @param {File} file - File object from file input
   * @returns {Promise<Array>} Array of mappings
   */
  async importFromJSON(file) {
    try {
      const text = await file.text();
      const mappings = JSON.parse(text);
      
      // Validate structure
      if (Array.isArray(mappings)) {
        return mappings;
      }
      
      throw new Error('Invalid mappings format: expected array');
    } catch (e) {
      console.error('Failed to import mappings:', e);
      throw e;
    }
  }

  /**
   * Get mappings from multiple sources (project file, localStorage)
   * Priority: project file > localStorage
   */
  async loadMappings(projectData = null) {
    // Try project file first
    if (projectData) {
      const projectMappings = this.loadFromProjectFile(projectData);
      if (projectMappings && projectMappings.length > 0) {
        return projectMappings;
      }
    }
    
    // Fallback to localStorage
    return this.loadFromLocalStorage();
  }

  /**
   * Save mappings to multiple locations
   * @param {Array} mappings - Mappings to save
   * @param {Object} projectData - Optional project data to embed mappings
   * @param {Boolean} saveToLocal - Also save to localStorage
   */
  async saveMappings(mappings, projectData = null, saveToLocal = true) {
    // Save to localStorage
    if (saveToLocal) {
      this.saveToLocalStorage(mappings);
    }
    
    // If project data provided, return updated project with embedded mappings
    if (projectData) {
      return this.saveToProjectFile(projectData, mappings);
    }
    
    return null;
  }
}

/**
 * Factory function
 */
export function createMappingStorage(filename = null) {
  return new MappingStorage(filename);
}
