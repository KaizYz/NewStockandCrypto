// Supabase Configuration
// StockandCrypto Project - Multi-user Notes & Chat System

const SUPABASE_CONFIG = {
  // Project URL
  url: 'https://odvelrdzdbnbfjuqrbtl.supabase.co',
  
  // Publishable Key (safe for browser, RLS enabled)
  anonKey: 'sb_publishable_sC7xCGB5GqtQwxV-zT35yQ_4vfRSF4p',
  
  // Project ID
  projectId: 'odvelrdzdbnbfjuqrbtl'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SUPABASE_CONFIG;
}
