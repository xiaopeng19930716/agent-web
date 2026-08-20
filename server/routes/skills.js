import fs from 'fs'
import { Router } from 'express'
import { getCandidateSkillDirs, scanSkills } from '../lib/skills.js'

const router = Router()

router.get('/skills', async (_req, res) => {
  try {
    const skills = await scanSkills()
    const sourceDirs = getCandidateSkillDirs().filter((d) => {
      try {
        return fs.existsSync(d) && fs.statSync(d).isDirectory()
      } catch {
        return false
      }
    })
    res.json({ skills, sourceDirs })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

export default router
