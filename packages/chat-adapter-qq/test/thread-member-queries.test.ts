import { describe, it, expect } from 'vitest';

import { createFriendInfo, createGroupMemberInfo } from './napcat-mock.js';
import { createQQTestContext } from './test-context.js';

describe('QQ adapter thread and member queries', () => {
  it('fetches thread metadata from NapCat APIs', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setGroupInfo(30003, {
      group_all_shut: 0,
      group_remark: 'remark',
      group_id: 30003,
      group_name: 'My Group',
      member_count: 233,
      max_member_count: 500
    });
    ctx.client.setStrangerInfo(20002, {
      user_id: 20002,
      nickname: 'alice',
      nick: 'alice',
      remark: 'stranger-remark',
      sex: 'female',
      qid: 'alice_qid',
      qqLevel: 12
    });
    ctx.client.setFriendList([
      createFriendInfo({
        userId: 20002,
        nickname: 'alice-friend',
        remark: 'friend-remark'
      })
    ]);

    const groupThread = await ctx.adapter.fetchThread('qq:group:30003');
    const privateThread = await ctx.adapter.fetchThread('qq:private:20002');

    expect({
      group: {
        channelName: groupThread.channelName,
        isDM: groupThread.isDM,
        groupId: (groupThread.metadata.group as { group_id: number }).group_id,
        groupName: (groupThread.metadata.group as { group_name: string }).group_name,
        memberCount: (groupThread.metadata.group as { member_count: number }).member_count
      },
      private: {
        channelName: privateThread.channelName,
        isDM: privateThread.isDM,
        source: privateThread.metadata.source,
        privateUserId: (privateThread.metadata.private as { user_id: number }).user_id,
        privateNickname: (privateThread.metadata.private as { nickname: string }).nickname,
        privateRemark: (privateThread.metadata.private as { remark: string }).remark
      },
      strangerCalls: ctx.client.getStrangerInfoCalls
    }).toMatchInlineSnapshot(`
      {
        "group": {
          "channelName": "My Group",
          "groupId": 30003,
          "groupName": "My Group",
          "isDM": false,
          "memberCount": 233,
        },
        "private": {
          "channelName": "friend-remark",
          "isDM": true,
          "privateNickname": "alice-friend",
          "privateRemark": "friend-remark",
          "privateUserId": 20002,
          "source": "friend_list",
        },
        "strangerCalls": [],
      }
    `);
  });

  it('fetches group members and single member with unified profile fields', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setGroupMembers(30003, [
      createGroupMemberInfo({
        groupId: 30003,
        userId: 10001,
        nickname: 'qq-bot',
        card: 'bot-card',
        isRobot: true,
        role: 'owner'
      }),
      createGroupMemberInfo({
        groupId: 30003,
        userId: 20002,
        nickname: 'alice',
        card: 'alice-card',
        isRobot: false
      })
    ]);

    const members = await ctx.adapter.fetchThreadMembers('qq:group:30003');
    const selfMember = members.find((item) => item.userId === '10001');
    const alice = await ctx.adapter.fetchThreadMember('qq:group:30003', '20002');
    const channelMembers = await ctx.adapter.fetchChannelMembers('qq:group:30003');
    const channelSelf = await ctx.adapter.fetchChannelMember('qq:group:30003', '10001');

    expect({
      members,
      selfMember,
      alice,
      channelMemberCount: channelMembers.length,
      channelSelfIsMe: channelSelf?.isMe,
      callStats: {
        memberList: ctx.client.getGroupMemberListCalls.length,
        memberInfo: ctx.client.getGroupMemberInfoCalls.length
      }
    }).toMatchInlineSnapshot(`
      {
        "alice": {
          "cardName": "alice-card",
          "isBot": false,
          "isMe": false,
          "raw": {
            "age": 0,
            "area": "",
            "card": "alice-card",
            "card_changeable": true,
            "group_id": 30003,
            "is_robot": false,
            "join_time": 0,
            "last_sent_time": 0,
            "level": "0",
            "nickname": "alice",
            "qq_level": 0,
            "role": "member",
            "sex": "unknown",
            "shut_up_timestamp": 0,
            "title": "",
            "title_expire_time": 0,
            "unfriendly": false,
            "user_id": 20002,
          },
          "userId": "20002",
          "userName": "alice",
        },
        "callStats": {
          "memberInfo": 2,
          "memberList": 2,
        },
        "channelMemberCount": 2,
        "channelSelfIsMe": true,
        "members": [
          {
            "cardName": "bot-card",
            "isBot": true,
            "isMe": true,
            "raw": {
              "age": 0,
              "area": "",
              "card": "bot-card",
              "card_changeable": true,
              "group_id": 30003,
              "is_robot": true,
              "join_time": 0,
              "last_sent_time": 0,
              "level": "0",
              "nickname": "qq-bot",
              "qq_level": 0,
              "role": "owner",
              "sex": "unknown",
              "shut_up_timestamp": 0,
              "title": "",
              "title_expire_time": 0,
              "unfriendly": false,
              "user_id": 10001,
            },
            "userId": "10001",
            "userName": "qq-bot",
          },
          {
            "cardName": "alice-card",
            "isBot": false,
            "isMe": false,
            "raw": {
              "age": 0,
              "area": "",
              "card": "alice-card",
              "card_changeable": true,
              "group_id": 30003,
              "is_robot": false,
              "join_time": 0,
              "last_sent_time": 0,
              "level": "0",
              "nickname": "alice",
              "qq_level": 0,
              "role": "member",
              "sex": "unknown",
              "shut_up_timestamp": 0,
              "title": "",
              "title_expire_time": 0,
              "unfriendly": false,
              "user_id": 20002,
            },
            "userId": "20002",
            "userName": "alice",
          },
        ],
        "selfMember": {
          "cardName": "bot-card",
          "isBot": true,
          "isMe": true,
          "raw": {
            "age": 0,
            "area": "",
            "card": "bot-card",
            "card_changeable": true,
            "group_id": 30003,
            "is_robot": true,
            "join_time": 0,
            "last_sent_time": 0,
            "level": "0",
            "nickname": "qq-bot",
            "qq_level": 0,
            "role": "owner",
            "sex": "unknown",
            "shut_up_timestamp": 0,
            "title": "",
            "title_expire_time": 0,
            "unfriendly": false,
            "user_id": 10001,
          },
          "userId": "10001",
          "userName": "qq-bot",
        },
      }
    `);
  });

  it('fetches private members from friend list first', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setFriendList([
      createFriendInfo({
        userId: 20002,
        nickname: 'alice-friend',
        remark: 'friend-remark'
      })
    ]);
    ctx.client.setStrangerInfo(20002, {
      user_id: 20002,
      nickname: 'alice-stranger',
      nick: 'alice-stranger',
      remark: 'stranger-remark',
      sex: 'female',
      qid: 'alice_qid',
      qqLevel: 12
    });

    const members = await ctx.adapter.fetchThreadMembers('qq:private:20002');
    const selfById = await ctx.adapter.fetchThreadMember('qq:private:20002', '10001');
    const peerByChannel = await ctx.adapter.fetchChannelMember('qq:private:20002', '20002');
    const unknown = await ctx.adapter.fetchThreadMember('qq:private:20002', '99999');

    expect({
      members,
      selfById,
      peerByChannel,
      unknown,
      calls: {
        friendListCalls: ctx.client.getFriendListCalls,
        strangerInfoCalls: ctx.client.getStrangerInfoCalls
      }
    }).toMatchInlineSnapshot(`
      {
        "calls": {
          "friendListCalls": 4,
          "strangerInfoCalls": [],
        },
        "members": [
          {
            "cardName": "",
            "isBot": true,
            "isMe": true,
            "raw": {
              "nickname": "qq-bot",
              "user_id": 10001,
            },
            "userId": "10001",
            "userName": "qq-bot",
          },
          {
            "cardName": "friend-remark",
            "isBot": false,
            "isMe": false,
            "raw": {
              "age": 0,
              "birthday_day": 0,
              "birthday_month": 0,
              "birthday_year": 0,
              "category_id": 0,
              "email": "",
              "level": 0,
              "nickname": "alice-friend",
              "phone_num": "",
              "remark": "friend-remark",
              "sex": "unknown",
              "user_id": 20002,
            },
            "userId": "20002",
            "userName": "alice-friend",
          },
        ],
        "peerByChannel": {
          "cardName": "friend-remark",
          "isBot": false,
          "isMe": false,
          "raw": {
            "age": 0,
            "birthday_day": 0,
            "birthday_month": 0,
            "birthday_year": 0,
            "category_id": 0,
            "email": "",
            "level": 0,
            "nickname": "alice-friend",
            "phone_num": "",
            "remark": "friend-remark",
            "sex": "unknown",
            "user_id": 20002,
          },
          "userId": "20002",
          "userName": "alice-friend",
        },
        "selfById": {
          "cardName": "",
          "isBot": true,
          "isMe": true,
          "raw": {
            "nickname": "qq-bot",
            "user_id": 10001,
          },
          "userId": "10001",
          "userName": "qq-bot",
        },
        "unknown": null,
      }
    `);
  });

  it('falls back to stranger info when peer is not in friend list', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setFriendList([]);
    ctx.client.setStrangerInfo(20002, {
      user_id: 20002,
      nickname: 'alice',
      nick: 'alice',
      remark: 'stranger-remark',
      sex: 'female',
      qid: 'alice_qid',
      qqLevel: 12
    });

    const members = await ctx.adapter.fetchThreadMembers('qq:private:20002');
    const peerMember = members.find((item) => item.userId === '20002');

    expect({
      peerMember,
      calls: {
        friendListCalls: ctx.client.getFriendListCalls,
        strangerInfoCalls: ctx.client.getStrangerInfoCalls
      }
    }).toMatchInlineSnapshot(`
      {
        "calls": {
          "friendListCalls": 1,
          "strangerInfoCalls": [
            20002,
          ],
        },
        "peerMember": {
          "cardName": "stranger-remark",
          "isBot": false,
          "isMe": false,
          "raw": {
            "nick": "alice",
            "nickname": "alice",
            "qid": "alice_qid",
            "qqLevel": 12,
            "remark": "stranger-remark",
            "sex": "female",
            "user_id": 20002,
          },
          "userId": "20002",
          "userName": "alice",
        },
      }
    `);
  });
});
