const {
  getSend,
  getBotMessages,
  newClubChannelPrefix,
  getMessageContents,
  getCaptainFromMessage,
  editErrorMessagePrefix,
} = require('./utils')
const {getSteps, getAnswers} = require('./steps')

async function handleUpdatedMessage(oldMessage, newMessage) {
  const {channel} = newMessage
  const send = getSend(channel)

  // must be a new club channel
  if (!channel.name.startsWith(newClubChannelPrefix)) return

  // when a link is expanded, that counts as an edit, but the content
  // doesn't change, so we'll ignore it.
  if (oldMessage.content === newMessage.content) return

  const member = getCaptainFromMessage(newMessage)
  if (!member) return

  const steps = getSteps(member)

  const messages = Array.from(
    (await newMessage.channel.messages.fetch()).values(),
  )
  const botMessages = getBotMessages(messages)
  const previousAnswers = getAnswers(botMessages, member)
  const messageAfterEditedMessage = messages[messages.indexOf(newMessage) - 1]
  if (!messageAfterEditedMessage) return

  const editedStep = steps.find(s =>
    s.getAnswer(messageAfterEditedMessage.content, member),
  )
  if (!editedStep) return

  const error = editedStep.validate(newMessage.content, previousAnswers)
  if (error) {
    await send(`${editErrorMessagePrefix} ${error}`)
    return
  }

  const promises = []

  // get the error message we printed previously due to any bad edits
  const stepErrorMessage = editedStep.validate(
    oldMessage.content,
    previousAnswers,
  )
  const editErrorMessages = botMessages.filter(({content}) =>
    content.startsWith(editErrorMessagePrefix),
  )
  const editErrorMessagesToDelete = editErrorMessages.filter(({content}) =>
    content.includes(stepErrorMessage),
  )
  promises.push(
    ...editErrorMessagesToDelete.map(m =>
      m.delete({reason: 'Edit error resolved.'}),
    ),
  )

  const answers = {...previousAnswers}
  answers[editedStep.name] = newMessage.content

  const contentAndMessages = []
  for (const step of steps.filter(s => !s.actionOnlyStep)) {
    contentAndMessages.push(
      [
        // eslint-disable-next-line no-await-in-loop
        await getMessageContents(step.question, answers, member),
        messages.find(msg => {
          if (step.isQuestionMessage) {
            return step.isQuestionMessage(msg.content)
          } else {
            return step.question === msg.content
          }
        }),
      ],
      [
        // eslint-disable-next-line no-await-in-loop
        await getMessageContents(step.feedback, answers, member),
        messages.find(msg => step.getAnswer(msg.content, member)),
        step,
      ],
    )
  }
  for (const [newContent, msg, step] of contentAndMessages) {
    if (msg && msg.content !== newContent) {
      promises.push(
        (async () => {
          await msg.edit(newContent)
          await step?.action?.({
            answers,
            member,
            channel,
            previousAnswers,
            isEdit: true,
          })
        })(),
      )
    }
  }

  await Promise.all(promises)

  if (editErrorMessages.length === editErrorMessagesToDelete.length) {
    const currentStep = steps
      .filter(s => !s.actionOnlyStep)
      .find(step => !answers.hasOwnProperty(step.name))
    if (currentStep) {
      await send(`Thanks for fixing things up, now we can continue.`)
      await send(
        await getMessageContents(currentStep.question, answers, member),
      )
    }
  }
}

module.exports = {handleUpdatedMessage}
