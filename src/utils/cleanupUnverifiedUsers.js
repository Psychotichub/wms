const User = require('../models/User');

/**
 * Clean up unverified users whose verification tokens/codes have expired
 * This removes users who haven't verified their email within the expiration period (24 hours)
 * 
 * @returns {Promise<Object>} - Result object with count of deleted users
 */
async function cleanupUnverifiedUsers() {
  try {
    const now = new Date();
    // Get expiry hours from environment (default: 0.25 hours = 15 minutes)
    const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
    const expiryTime = expiryHours * 60 * 60 * 1000; // Convert to milliseconds
    const expiryDate = new Date(now.getTime() - expiryTime);
    
    // Find users who:
    // 1. Have not verified their email (isEmailVerified: false)
    // 2. Have expired verification tokens/codes OR were created more than expiryHours ago
    // 3. Were created via signup (not by admin) - only delete signup-created users
    // 4. This ensures we clean up accounts that are definitely expired
    const expiredUsers = await User.find({
      isEmailVerified: false,
      createdByAdmin: { $ne: true }, // Only delete users created via signup, not by admin
      $or: [
        // Token expired
        { emailVerificationTokenExpiry: { $lt: now } },
        // Code expired
        { emailVerificationCodeExpiry: { $lt: now } },
        // Account created more than expiryHours ago (fallback if expiry dates are missing)
        { createdAt: { $lt: expiryDate } }
      ]
    });

    if (expiredUsers.length === 0) {
      return {
        checked: 0,
        deleted: 0,
        message: 'No expired unverified users found'
      };
    }

    // Get user IDs and emails for logging
    const userIds = expiredUsers.map(u => u._id);
    const userEmails = expiredUsers.map(u => u.email);

    // Delete expired unverified users
    const deleteResult = await User.deleteMany({
      _id: { $in: userIds }
    });

    console.log(`[Cleanup] Deleted ${deleteResult.deletedCount} unverified users:`, userEmails);

    return {
      checked: expiredUsers.length,
      deleted: deleteResult.deletedCount,
      emails: userEmails,
      message: `Successfully deleted ${deleteResult.deletedCount} expired unverified user(s)`
    };
  } catch (error) {
    console.error('[Cleanup] Error cleaning up unverified users:', error);
    throw error;
  }
}

module.exports = {
  cleanupUnverifiedUsers
};
