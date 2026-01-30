#!/usr/bin/env node

/**
 * Node.js script to update attendance document for checkout status
 * 
 * Usage:
 *   node update_attendance.js
 * 
 * Make sure you have MONGO_URI set in your environment or .env file
 */

const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Load environment variables using the same logic as server.js
// 1) Load base `.env` first (so APP_ENV can be read from it).
dotenv.config();

const appEnv = (process.env.APP_ENV || 'development').toLowerCase();
const envFile = path.resolve(__dirname, `.env.${appEnv}`);
if (appEnv !== 'production' && fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

// Resolve env-specific vars (allows using *_DEV / *_PROD in addition to plain vars)
const isProdEnv = appEnv === 'production' || appEnv === 'prod';
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  (isProdEnv ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV) ||
  process.env.MONGO_URI;

// ===== CONFIGURATION =====
const attendanceId = process.argv[2] || "697d1d54da22f67afba08b93"; // Can pass as command line argument
const checkoutHour = 21;   // Hour in UTC (0-23)
const checkoutMinute = 7;   // Minute (0-59)
const checkoutSecond = 6;   // Second (0-59)
const checkoutMs = 397;     // Milliseconds (0-999)
const workDurationHours = 1; // Hours worked (time between check-in and check-out)

// ===== MAIN FUNCTION =====
async function updateAttendance() {
  try {
    // Get MongoDB URI from environment
    const mongoUri = process.env.MONGO_URI || process.env.MONGO_URI_DEV || process.env.MONGO_URI_PROD;
    
    if (!mongoUri) {
      console.error('❌ ERROR: MONGO_URI is not set in environment variables');
      console.error('Please set MONGO_URI in your .env file or environment');
      console.error('Example: MONGO_URI=mongodb://localhost:27017/your-database');
      process.exit(1);
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Get today's date at midnight UTC
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

    // Set checkout time to specified time today
    const checkoutTime = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      checkoutHour,
      checkoutMinute,
      checkoutSecond,
      checkoutMs
    ));

    // Set check-in time (workDurationHours before checkout)
    const checkinTime = new Date(checkoutTime.getTime() - (workDurationHours * 60 * 60 * 1000));

    // Calculate total hours
    const totalHours = (checkoutTime - checkinTime) / (1000 * 60 * 60);

    console.log('=== Updating Attendance Document ===');
    console.log('Document ID:', attendanceId);
    console.log('Current date (UTC):', now.toISOString());
    console.log('Today (midnight UTC):', today.toISOString());
    console.log('Check-in:', checkinTime.toISOString());
    console.log('Check-out:', checkoutTime.toISOString());
    console.log('Total hours:', totalHours.toFixed(4));
    console.log('');

    // Load models (Employee must be loaded before populating)
    require('./src/models/Employee');
    const Attendance = require('./src/models/Attendance');

    // First, let's check what employee ID is in the document
    const existingDoc = await Attendance.findById(attendanceId);
    if (existingDoc) {
      console.log('📋 Existing document found:');
      const employeeId = existingDoc.employee?.toString() || existingDoc.employee;
      console.log('  Employee ID:', employeeId || 'null');
      
      // Try to populate employee if it's an ObjectId
      if (existingDoc.employee && mongoose.Types.ObjectId.isValid(existingDoc.employee)) {
        try {
          await existingDoc.populate('employee');
          if (existingDoc.employee && typeof existingDoc.employee === 'object' && existingDoc.employee.name) {
            console.log('  Employee Name:', existingDoc.employee.name);
            console.log('  Employee Email:', existingDoc.employee.email || 'N/A');
          }
        } catch (populateError) {
          console.log('  (Could not populate employee details)');
        }
      }
      
      console.log('  Current status:', existingDoc.status);
      console.log('  Current clockOutTime:', existingDoc.clockOutTime?.toISOString() || 'null');
      console.log('');
      if (employeeId) {
        console.log('⚠️  IMPORTANT: Make sure you are logged in as user ID:', employeeId);
        console.log('   The backend will only return checkout status for the logged-in user.');
        console.log('');
      }
    } else {
      console.error('❌ ERROR: Document not found with ID:', attendanceId);
      process.exit(1);
    }

    // Update the document
    const result = await Attendance.updateOne(
      { _id: new mongoose.Types.ObjectId(attendanceId) },
      {
        $set: {
          date: today,
          clockInTime: checkinTime,
          clockOutTime: checkoutTime,
          totalHours: totalHours,
          status: 'completed',
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      console.error('❌ ERROR: No document found with ID:', attendanceId);
      console.error('Please check that the document exists in the database.');
      process.exit(1);
    } else if (result.modifiedCount === 0) {
      console.warn('⚠️  WARNING: Document found but no changes were made.');
      console.warn('The document may already have these values.');
    } else {
      console.log('✅ SUCCESS: Attendance document updated successfully!');
      console.log('Matched:', result.matchedCount, 'document(s)');
      console.log('Modified:', result.modifiedCount, 'document(s)');
    }

    console.log('');
    console.log('=== Summary ===');
    console.log('Checkout time:', checkoutTime.toISOString());
    console.log('Date:', today.toISOString());
    console.log('Status: completed');
    console.log('');
    console.log('You can now check the Attendance Status screen in your app.');

    // Close connection
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
updateAttendance();
