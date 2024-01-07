export function getSessionMembersData(socket, sessionId, sessionCreators, options) {
  let sessionMemberIdsSet = socket.adapter.rooms.get(sessionId)
  if (options && options.removeDisconnectingSocket === true) {
    sessionMemberIdsSet.delete(socket.id) 
  }
  let sessionMemberIdsArray = [...sessionMemberIdsSet]

  let sessionMembersData = sessionMemberIdsArray.map((sessionMemberId) => {
    return {
      id: sessionMemberId,
      hasPaid: false,
      isSessionCreator: sessionCreators[sessionId] === sessionMemberId
    }
  })

  return sessionMembersData
}