const User = require('../models/User');
const RateLimitRequest = require('../models/RateLimitRequest');

module.exports = {
  // Get all rate limit requests
  getRateLimitRequests: async (req, res) => {
    try {
      // Get query parameters for filtering
      const { status, type, sort } = req.query;
      
      // Build query
      const query = {};
      if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        query.status = status;
      }
      if (type && ['chat', 'image'].includes(type)) {
        query.requestType = type;
      }
      
      // Get requests with user info
      const requests = await RateLimitRequest.find(query)
        .populate('userId', 'username email profilePicture')
        .populate('reviewedBy', 'username email')
        .sort(sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 });
      
      res.render('admin/rate-limits', {
        title: 'Rate Limit Requests - FTRAISE AI',
        requests,
        status: status || 'all',
        type: type || 'all',
        sort: sort || 'newest',
        path: '/admin/rate-limits',
        layout: 'layouts/no-footer'
      });
    } catch (err) {
      console.error('Error getting rate limit requests:', err);
      req.flash('error_msg', 'An error occurred while loading rate limit requests');
      res.redirect('/admin');
    }
  },
  
  // Get rate limit request details
  getRateLimitRequestDetails: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get request with user info
      const request = await RateLimitRequest.findById(id)
        .populate('userId', 'username email profilePicture')
        .populate('reviewedBy', 'username email');
      
      if (!request) {
        req.flash('error_msg', 'Request not found');
        return res.redirect('/admin/rate-limits');
      }
      
      // Get user's current limits
      let user = null;
      if (request.userId) {
        user = await User.findById(request.userId._id);
      }
      
      res.render('admin/rate-limit-detail', {
        title: 'Rate Limit Request Details - FTRAISE AI',
        request,
        user,
        path: '/admin/rate-limits',
        layout: 'layouts/no-footer'
      });
    } catch (err) {
      console.error('Error getting rate limit request details:', err);
      req.flash('error_msg', 'An error occurred while loading request details');
      res.redirect('/admin/rate-limits');
    }
  },
  
  // Approve rate limit request
  approveRequest: async (req, res) => {
    try {
      const { id } = req.params;
      const { adminNotes } = req.body;
      
      // Get request
      const request = await RateLimitRequest.findById(id);
      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }
      
      // Check if request is already processed
      if (request.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `This request has already been ${request.status}`
        });
      }
      
      // Update request
      request.status = 'approved';
      request.adminNotes = adminNotes || '';
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      
      // Update user's rate limit
      const user = await User.findById(request.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      if (request.requestType === 'chat') {
        user.chatRateLimit = request.requestedLimit;
      } else {
        user.imageRateLimit = request.requestedLimit;
      }
      
      // Save changes
      await Promise.all([request.save(), user.save()]);
      
      res.json({
        success: true,
        message: 'Rate limit request approved successfully'
      });
    } catch (err) {
      console.error('Error approving rate limit request:', err);
      res.status(500).json({
        success: false,
        message: 'An error occurred while approving the request'
      });
    }
  },
  
  // Reject rate limit request
  rejectRequest: async (req, res) => {
    try {
      const { id } = req.params;
      const { adminNotes } = req.body;
      
      // Get request
      const request = await RateLimitRequest.findById(id);
      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }
      
      // Check if request is already processed
      if (request.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `This request has already been ${request.status}`
        });
      }
      
      // Update request
      request.status = 'rejected';
      request.adminNotes = adminNotes || '';
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      
      // Save changes
      await request.save();
      
      res.json({
        success: true,
        message: 'Rate limit request rejected successfully'
      });
    } catch (err) {
      console.error('Error rejecting rate limit request:', err);
      res.status(500).json({
        success: false,
        message: 'An error occurred while rejecting the request'
      });
    }
  },
  
  // Update user's rate limits directly
  updateUserRateLimits: async (req, res) => {
    try {
      const { userId } = req.params;
      const { chatLimit, imageLimit, adminNotes } = req.body;
      
      // Validate input
      if ((!chatLimit && chatLimit !== 0) || isNaN(chatLimit) || chatLimit < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid chat limit. Must be a non-negative number.'
        });
      }
      
      if ((!imageLimit && imageLimit !== 0) || isNaN(imageLimit) || imageLimit < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid image limit. Must be a non-negative number.'
        });
      }
      
      // Get user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      // Update user's rate limits
      user.chatRateLimit = parseInt(chatLimit);
      user.imageRateLimit = parseInt(imageLimit);
      
      // Save changes
      await user.save();
      
      // Create a record of this manual update
      const manualUpdate = new RateLimitRequest({
        userId,
        requestType: 'manual',
        currentLimit: 0, // Not applicable for manual updates
        requestedLimit: 0, // Not applicable for manual updates
        reason: 'Manual update by admin',
        status: 'approved',
        adminNotes: adminNotes || 'Manual update of rate limits',
        reviewedBy: req.user._id,
        reviewedAt: new Date()
      });
      
      await manualUpdate.save();
      
      res.json({
        success: true,
        message: 'User rate limits updated successfully'
      });
    } catch (err) {
      console.error('Error updating user rate limits:', err);
      res.status(500).json({
        success: false,
        message: 'An error occurred while updating rate limits'
      });
    }
  }
};
