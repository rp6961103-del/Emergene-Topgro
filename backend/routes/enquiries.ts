import { Router, Request, Response } from 'express';
import { db } from '../services/db.ts';
import { requireAdmin, AuthRequest } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

// GET /api/enquiries - Admin view enquiries
router.get('/', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const enquiries = db.enquiries.getAll();
    logger.info(`Admin fetched enquiries: ${enquiries.length} records`, { requestId, userId: req.user?.id });
    res.json(enquiries);
  } catch (err: any) {
    logger.error('Failed to get enquiries', err, { requestId });
    res.status(500).json({
      error: 'Failed to retrieve enquiries',
      code: 'ENQUIRIES_FETCH_FAILED',
      requestId
    });
  }
});

// POST /api/enquiries - Public submit enquiry
router.post('/', (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  try {
    const { name, phone, email, subject, message } = req.body;
    if (!name || !phone || !message) {
      return res.status(400).json({
        error: 'Name, phone number and message are required',
        code: 'VALIDATION_ERROR',
        requestId
      });
    }

    const newEnquiry = db.enquiries.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : '',
      subject: subject ? subject.trim() : 'General Agricultural Enquiry',
      message: message.trim()
    });

    logger.info(`New enquiry received from ${newEnquiry.name} (${newEnquiry.phone})`, { requestId });

    res.status(201).json(newEnquiry);
  } catch (err: any) {
    logger.error('Failed to submit enquiry', err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to submit enquiry',
      code: 'ENQUIRY_SUBMIT_FAILED',
      requestId
    });
  }
});

// PUT /api/enquiries/:id/status - Admin update enquiry status
router.put('/:id/status', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  const { status } = req.body;
  if (!status || !['new', 'responded'].includes(status)) {
    return res.status(400).json({
      error: 'Invalid status. Must be "new" or "responded"',
      code: 'INVALID_STATUS',
      requestId
    });
  }

  try {
    const updated = db.enquiries.updateStatus(req.params.id, status);
    if (!updated) {
      return res.status(404).json({
        error: 'Enquiry not found',
        code: 'ENQUIRY_NOT_FOUND',
        requestId
      });
    }

    logger.info(`Enquiry ${req.params.id} status updated to '${status}' by admin`, {
      requestId,
      userId: req.user?.id
    });

    res.json(updated);
  } catch (err: any) {
    logger.error(`Failed to update enquiry status for ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to update enquiry status',
      code: 'ENQUIRY_UPDATE_FAILED',
      requestId
    });
  }
});

export default router;
