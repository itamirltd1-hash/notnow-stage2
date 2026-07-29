import express from 'express';
import { requireUser } from '../middleware/requireUser.js';
import { getUserContacts, userQuery } from '../db/multitenancyHelpers.js';

const router = express.Router();

/**
 * GET /api/contacts
 * List all contacts for the authenticated user.
 */
router.get('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const result = await getUserContacts(userId);

    res.json({
      success: true,
      data: {
        count: result.rows.length,
        contacts: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching contacts:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
});

/**
 * POST /api/contacts
 * Create a new contact.
 */
router.post('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { name, phone_number, email, company_name } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, phone_number'
      });
    }

    const result = await userQuery(
      userId,
      `INSERT INTO contacts (user_id, name, phone_number, email, company_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, phone_number, email, company_name]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Contact already exists' });
    }
    console.error('Error creating contact:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create contact' });
  }
});

/**
 * DELETE /api/contacts/:contactId
 * Delete a contact.
 */
router.delete('/:contactId', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const contactId = parseInt(req.params.contactId, 10);

    const result = await userQuery(
      userId,
      'DELETE FROM contacts WHERE contact_id = $2 AND user_id = $1 RETURNING *',
      [contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({ success: true, data: { message: 'Contact deleted' } });
  } catch (error) {
    console.error('Error deleting contact:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete contact' });
  }
});

export default router;
