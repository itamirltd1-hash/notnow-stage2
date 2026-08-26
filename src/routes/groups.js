import express from 'express';
import { requireUser } from '../middleware/requireUser.js';
import {
  listGroups, createGroup, getGroupMembers,
  addGroupMember, removeGroupMember
} from '../groups/groupService.js';
import pool from '../db/pool.js';

const router = express.Router();

router.use(requireUser);

/** GET /api/groups — every group this user has, with member counts. */
router.get('/', async (req, res) => {
  try {
    const groups = await listGroups(req.userId);
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error('Error listing groups:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list groups' });
  }
});

/** POST /api/groups — create a group. */
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }

  try {
    const group = await createGroup(req.userId, name);
    res.status(201).json({ success: true, data: group });
  } catch (error) {
    console.error('Error creating group:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create group' });
  }
});

/** GET /api/groups/:groupId/members — members plus their consent state. */
router.get('/:groupId/members', async (req, res) => {
  try {
    const members = await getGroupMembers(req.userId, Number(req.params.groupId));
    res.json({ success: true, data: members });
  } catch (error) {
    console.error('Error listing members:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list members' });
  }
});

/** POST /api/groups/:groupId/members — add one member by phone. */
router.post('/:groupId/members', async (req, res) => {
  const { phone, name } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' });
  }

  const groupId = Number(req.params.groupId);

  try {
    // Confirm the group belongs to this user before touching its membership.
    const owned = await pool.query(
      'SELECT 1 FROM groups WHERE group_id = $1 AND user_id = $2',
      [groupId, req.userId]
    );
    if (owned.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const contactId = await addGroupMember(req.userId, groupId, phone, name);
    res.status(201).json({ success: true, data: { contact_id: contactId } });
  } catch (error) {
    console.error('Error adding member:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

/** DELETE /api/groups/:groupId/members/:contactId */
router.delete('/:groupId/members/:contactId', async (req, res) => {
  try {
    const removed = await removeGroupMember(
      req.userId, Number(req.params.groupId), Number(req.params.contactId)
    );
    if (!removed) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error.message);
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

export default router;
