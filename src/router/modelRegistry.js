// Simple model registry for Mobius
class ModelRegistry {
  constructor() {
    this.models = new Map();
  }

  register(model) {
    this.models.set(model.name, model);
  }

  get(name) {
    return this.models.get(name);
  }

  list() {
    return Array.from(this.models.values());
  }

  findBest(task, privateTask) {
    // Prioritize Groq if available, otherwise try local
    if (this.models.has('groq')) {
      return this.models.get('groq');
    }
    if (this.models.has('local')) {
      return this.models.get('local');
    }
    // Fallback to any available model
    return this.models.values().next().value;
  }
}

export const registry = new ModelRegistry();
