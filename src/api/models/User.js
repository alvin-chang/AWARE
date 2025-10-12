// src/api/models/User.js
// User model for storing user information securely

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Define the path for the users data file
const USERS_DATA_FILE = path.join(__dirname, '..', '..', 'data', 'users.json');

// Ensure the data directory exists
const dataDir = path.dirname(USERS_DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create the users file if it doesn't exist
if (!fs.existsSync(USERS_DATA_FILE)) {
  fs.writeFileSync(USERS_DATA_FILE, JSON.stringify({ users: [] }, null, 2));
}

class User {
  constructor(userData) {
    this.id = userData.id || crypto.randomUUID();
    this.username = userData.username;
    this.email = userData.email || '';
    this.passwordHash = userData.passwordHash;
    this.salt = userData.salt;
    this.role = userData.role || 'user';
    this.createdAt = userData.createdAt || new Date().toISOString();
    this.updatedAt = userData.updatedAt || new Date().toISOString();
    this.isActive = userData.isActive !== undefined ? userData.isActive : true;
  }

  // Hash a password with salt
  static hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  }

  // Generate a random salt
  static generateSalt() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Validate a password against the stored hash
  static validatePassword(password, salt, hash) {
    const hashedPassword = this.hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(hashedPassword, 'hex'), Buffer.from(hash, 'hex'));
  }

  // Create a new user
  static create(username, email, password, role = 'user') {
    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);
    
    const newUser = new User({
      username,
      email,
      passwordHash,
      salt,
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    });
    
    // Save the user to the data file
    this.saveUser(newUser);
    
    return newUser;
  }

  // Find a user by username
  static findByUsername(username) {
    const usersData = JSON.parse(fs.readFileSync(USERS_DATA_FILE, 'utf8'));
    const userData = usersData.users.find(u => u.username === username);
    
    if (!userData) {
      return null;
    }
    
    return new User(userData);
  }

  // Find a user by ID
  static findById(id) {
    const usersData = JSON.parse(fs.readFileSync(USERS_DATA_FILE, 'utf8'));
    const userData = usersData.users.find(u => u.id === id);
    
    if (!userData) {
      return null;
    }
    
    return new User(userData);
  }

  // Save a user to the data file
  static saveUser(user) {
    const usersData = JSON.parse(fs.readFileSync(USERS_DATA_FILE, 'utf8'));
    
    // Check if user already exists
    const existingUserIndex = usersData.users.findIndex(u => u.id === user.id);
    
    if (existingUserIndex !== -1) {
      // Update existing user
      usersData.users[existingUserIndex] = user;
    } else {
      // Add new user
      usersData.users.push(user);
    }
    
    // Write updated data back to file
    fs.writeFileSync(USERS_DATA_FILE, JSON.stringify(usersData, null, 2));
  }

  // Get all users
  static getAllUsers() {
    const usersData = JSON.parse(fs.readFileSync(USERS_DATA_FILE, 'utf8'));
    return usersData.users.map(userData => new User(userData));
  }

  // Update user information
  static updateUser(id, updates) {
    const user = this.findById(id);
    
    if (!user) {
      return null;
    }
    
    // Update allowed fields
    if (updates.email !== undefined) user.email = updates.email;
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.isActive !== undefined) user.isActive = updates.isActive;
    user.updatedAt = new Date().toISOString();
    
    // Save updated user
    this.saveUser(user);
    
    return user;
  }

  // Change user password
  static changePassword(id, newPassword) {
    const user = this.findById(id);
    
    if (!user) {
      return null;
    }
    
    // Generate new salt and hash
    const newSalt = this.generateSalt();
    const newPasswordHash = this.hashPassword(newPassword, newSalt);
    
    // Update user password
    user.salt = newSalt;
    user.passwordHash = newPasswordHash;
    user.updatedAt = new Date().toISOString();
    
    // Save updated user
    this.saveUser(user);
    
    return user;
  }

  // Validate user credentials
  static validateCredentials(username, password) {
    const user = this.findByUsername(username);
    
    if (!user || !user.isActive) {
      return null;
    }
    
    if (this.validatePassword(password, user.salt, user.passwordHash)) {
      return user;
    }
    
    return null;
  }
}

module.exports = User;