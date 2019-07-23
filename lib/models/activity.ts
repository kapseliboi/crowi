import * as mongoose from 'mongoose'
import Debug from 'debug'

type ObjectId = mongoose.Types.ObjectId
export interface ActivityDocument extends mongoose.Document {
  user: ObjectId | any
  targetModel: string
  target: String
  action: String
  event: mongoose.Types.ObjectId
  eventModel: String
  createdAt: Date

  getSameActivities(): Promise<ActivityDocument[]>
  getNotificationTargetUsers(): Promise<any[]>
}

export interface ActivityModel extends mongoose.Model<ActivityDocument> {
  getSameActivities(parameters: any): Promise<ActivityDocument>
  createByParameters(parameters: any): Promise<ActivityDocument>
  removeByParameters(parameters: any): any
  createByPageComment(comment: any): Promise<ActivityDocument>
  createByPageLike(page: any, user: any): Promise<ActivityDocument>
  removeByPageUnlike(page: any, user: any): Promise<ActivityDocument>
  removeByPage(page: any): Promise<ActivityDocument>
  findByUser(user: any): Promise<ActivityDocument[]>
  getActionUsersFromActivities(activities: ActivityDocument[]): any[]
}

export default (crowi) => {
  const debug = Debug('crowi:models:activity')
  const ObjectId = mongoose.Schema.Types.ObjectId
  const ActivityDefine = require('../util/activityDefine')()
  const activityEvent = crowi.event('Activity')

  // TODO: add revision id
  const activitySchema = new mongoose.Schema<ActivityDocument, ActivityModel>({
    user: {
      type: ObjectId,
      ref: 'User',
      index: true,
      require: true,
    },
    targetModel: {
      type: String,
      require: true,
      enum: ActivityDefine.getSupportTargetModelNames(),
    },
    target: {
      type: ObjectId,
      refPath: 'targetModel',
      require: true,
    },
    action: {
      type: String,
      require: true,
      enum: ActivityDefine.getSupportActionNames(),
    },
    event: {
      type: ObjectId,
      refPath: 'eventModel',
    },
    eventModel: {
      type: String,
      enum: ActivityDefine.getSupportEventModelNames(),
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  })
  activitySchema.index({ target: 1, action: 1 })
  activitySchema.index({ user: 1, target: 1, action: 1, createdAt: 1 }, { unique: true })

  /**
   * @param {object} parameters
   * @return {Promise}
   */
  activitySchema.statics.createByParameters = function(parameters) {
    const Activity = this

    return new Promise(function(resolve, reject) {
      try {
        resolve(Activity.create(parameters))
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * @param {object} parameters
   */
  activitySchema.statics.removeByParameters = function(parameters) {
    const Activity = this

    return new Promise(async function(resolve, reject) {
      try {
        const activity = await Activity.findOne(parameters)
        activityEvent.emit('remove', activity)
        resolve(Activity.remove(parameters))
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * @param {Comment} comment
   * @return {Promise}
   */
  activitySchema.statics.createByPageComment = function(comment) {
    let parameters = {
      user: comment.creator,
      targetModel: ActivityDefine.MODEL_PAGE,
      target: comment.page,
      eventModel: ActivityDefine.MODEL_COMMENT,
      event: comment._id,
      action: ActivityDefine.ACTION_COMMENT,
    }

    return this.createByParameters(parameters)
  }

  /**
   * @param {Page} page
   * @param {User} user
   * @return {Promise}
   */
  activitySchema.statics.createByPageLike = function(page, user) {
    let parameters = {
      user: user._id,
      targetModel: ActivityDefine.MODEL_PAGE,
      target: page,
      action: ActivityDefine.ACTION_LIKE,
    }

    return this.createByParameters(parameters)
  }

  /**
   * @param {Page} page
   * @param {User} user
   * @return {Promise}
   */
  activitySchema.statics.removeByPageUnlike = function(page, user) {
    let parameters = {
      user: user,
      targetModel: ActivityDefine.MODEL_PAGE,
      target: page,
      action: ActivityDefine.ACTION_LIKE,
    }

    return this.removeByParameters(parameters)
  }

  /**
   * @param {Page} page
   * @return {Promise}
   */
  activitySchema.statics.removeByPage = async function(page) {
    const Activity = this
    const activities = await Activity.find({ target: page })
    for (let activity of activities) {
      activityEvent.emit('remove', activity)
    }
    return Activity.remove({ target: page })
  }

  /**
   * @param {User} user
   * @return {Promise}
   */
  activitySchema.statics.findByUser = function(user) {
    let Activity = this

    return new Promise(function(resolve, reject) {
      Activity.find({ user: user })
        .sort({ createdAt: -1 })
        .exec(function(err, notifications) {
          if (err) {
            return reject(err)
          }

          return resolve(notifications)
        })
    })
  }

  activitySchema.statics.getActionUsersFromActivities = function(activities) {
    return activities.map(({ user }) => user).filter((user, i, self) => self.indexOf(user) === i)
  }

  activitySchema.methods.getSameActivities = function() {
    const self = this
    const Activity = self.model('Activity')
    const { target, action } = self
    const query = { target, action }
    const limit = 1000

    return new Promise(function(resolve, reject) {
      Activity.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec(function(err, activities) {
          if (err) {
            reject(err)
          }

          debug(activities)
          resolve(activities as any)
        })
    })
  }

  activitySchema.methods.getNotificationTargetUsers = async function() {
    const User = crowi.model('User')
    const Watcher = crowi.model('Watcher')
    const { user: actionUser, targetModel, target } = this

    const model: any = await this.model(targetModel).findById(target)
    const [targetUsers, watchUsers, ignoreUsers] = await Promise.all([
      model.getNotificationTargetUsers(),
      Watcher.getWatchers(target),
      Watcher.getIgnorers(target),
    ])

    const unique = array => Object.values(array.reduce((objects, object) => ({ ...objects, [object.toString()]: object }), {}))
    const filter = (array, pull) => {
      const ids = pull.map(object => object.toString())
      return array.filter(object => !ids.includes(object.toString()))
    }
    const notificationUsers = filter(unique([...targetUsers, ...watchUsers]), [...ignoreUsers, actionUser])
    const activeNotificationUsers = await User.find({
      _id: { $in: notificationUsers },
      status: User.STATUS_ACTIVE,
    }).distinct('_id')
    return activeNotificationUsers
  }

  /**
   * saved hook
   */
  activitySchema.post('save', async function(savedActivity: ActivityDocument) {
    const Notification = crowi.model('Notification')
    try {
      const [notificationUsers, sameActivities] = await Promise.all([savedActivity.getNotificationTargetUsers(), savedActivity.getSameActivities()])

      const notificationPromises = notificationUsers.map(user => {
        const filteredActivities = sameActivities.filter(({ user: sameActionUser }) => user.toString() !== sameActionUser.toString())
        return Notification.upsertByActivity(user, filteredActivities, savedActivity)
      })
      return Promise.all(notificationPromises)
    } catch (err) {
      debug(err)
    }
  })

  // because mongoose's 'remove' hook fired only when remove by a method of Document (not by a Model method)
  // move 'save' hook from mongoose's events to activityEvent if I have a time.
  activityEvent.on('remove', async function(activity: ActivityDocument) {
    const Notification = crowi.model('Notification')

    try {
      await Notification.removeActivity(activity)
    } catch (err) {
      debug(err)
    }
  })

  return mongoose.model<ActivityDocument, ActivityModel>('Activity', activitySchema)
}