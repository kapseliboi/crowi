const faker = require('faker')

describe('Activity', function() {
  const mongoose = require('mongoose')
  const Activity = crowi.model('Activity')
  const User = crowi.model('User')
  const Page = crowi.model('Page')
  const Comment = crowi.model('Comment')
  const Watcher = crowi.model('Watcher')
  const conn = crowi.getMongo().connection
  const ObjectId = mongoose.Types.ObjectId

  describe('.createByParameters', function() {
    describe('correct parameters', function() {
      it('should create', function() {
        const userId = ObjectId()
        const targetId = ObjectId()

        const parameters = {
          user: userId,
          targetModel: 'Page',
          target: targetId,
          action: 'COMMENT',
        }

        return Activity.createByParameters(parameters).then(
          function(activity) {
            expect(activity.user).toBe(userId)
            expect(activity.target).toBe(targetId)
            expect(activity.targetModel).toBe('Page')
            expect(activity.action).toBe('COMMENT')
          },
          function(err) {
            throw new Error(err)
          },
        )
      })
    })

    describe('invalid parameters', function() {
      it('should not create', function() {
        const userId = ObjectId()
        const targetId = ObjectId()

        const parameters = {
          user: userId,
          targetModel: 'Page2', // validation error
          target: targetId,
          action: 'COMMENT',
        }

        return expect(Activity.createByParameters(parameters)).rejects.toThrow('Activity validation failed')
      })
    })
  })

  describe('.removeByParameters', () => {
    describe('correct parameters', () => {
      const user = ObjectId()
      const target = ObjectId()
      const parameters = { user, targetModel: 'Page', target, action: 'COMMENT' }

      beforeAll(async () => {
        await Activity.createByParameters(parameters)
      })

      it('should remove', async () => {
        const { n } = await Activity.removeByParameters(parameters)
        expect(n).toBe(1)
      })
    })
  })

  describe('Target users', () => {
    const userIds = [ObjectId(), ObjectId(), ObjectId()]
    const pageId = ObjectId()
    const activityId = ObjectId()

    beforeAll(async () => {
      await Promise.all([User, Page, Comment, Watcher, Activity].map(model => model.remove({})))

      const users = [
        { _id: userIds[0], email: faker.internet.email(), status: User.STATUS_ACTIVE },
        { _id: userIds[1], email: faker.internet.email(), status: User.STATUS_ACTIVE },
        { _id: userIds[2], email: faker.internet.email(), status: User.STATUS_SUSPENDED },
      ]
      const pages = [{ _id: pageId, path: `/${faker.lorem.word()}`, grant: Page.GRANT_PUBLIC, creator: userIds[0] }]
      const comments = userIds.map(userId => ({ page: pageId, creator: userId, comment: faker.lorem.word() }))

      await testDBUtil.generateFixture(conn, 'User', users)
      await testDBUtil.generateFixture(conn, 'Page', pages)
      await testDBUtil.generateFixture(conn, 'Comment', comments)
    })

    afterEach(async () => {
      await Promise.all([Watcher, Activity].map(model => model.remove({})))
    })

    describe('Action User and Suspended User', () => {
      let notificationUsers
      beforeAll(async () => {
        const activity = await Activity.createByParameters({ user: userIds[0], target: pageId, targetModel: 'Page', action: 'COMMENT' })
        notificationUsers = (await activity.getNotificationTargetUsers()).map(String)
      })

      it('is not contain action user', () => {
        expect(notificationUsers).not.toContain(String(userIds[0]))
      })

      it('is not contain suspended user', () => {
        expect(notificationUsers).not.toContain(String(userIds[2]))
      })
    })

    describe('Watch', () => {
      beforeAll(async () => {
        await Watcher.watchByPageId(userIds[1], pageId, Watcher.STATUS_WATCH)
      })

      it('is watched', async () => {
        const activity = await Activity.createByParameters({ user: userIds[0], target: pageId, targetModel: 'Page', action: 'COMMENT' })
        const notificationUsers = (await activity.getNotificationTargetUsers()).map(String)

        expect(notificationUsers).toContain(String(userIds[1]))
      })
    })

    describe('Ignore', () => {
      beforeAll(async () => {
        await Watcher.watchByPageId(userIds[1], pageId, Watcher.STATUS_IGNORE)
      })

      it('is ignored', async () => {
        const activity = await Activity.createByParameters({ user: userIds[0], target: pageId, targetModel: 'Page', action: 'COMMENT' })
        const notificationUsers = (await activity.getNotificationTargetUsers()).map(String)

        expect(notificationUsers).not.toContain(String(userIds[1]))
      })
    })
  })
})
