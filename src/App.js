import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Papa from 'papaparse';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://quizzler-production.up.railway.app';

export default function QuizzlerHostApp() {
  const [socket, setSocket] = useState(null);
  const [screen, setScreen] = useState('start');
  const [hostName, setHostName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueSpecials, setVenueSpecials] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [game, setGame] = useState(null);
  const [questions, setQuestions] = useState(Array(15).fill({ category: '', question: '', answer: '' }));
  const [finalQuestion, setFinalQuestion] = useState({ category: '', question: '', answer: '' });
  const [selectedTeamHistory, setSelectedTeamHistory] = useState(null);

  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => console.log('Connected'));
    newSocket.on('error', (error) => alert(error.message));

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (!socket || !gameCode) return;

    socket.on('host:joined', (data) => {
      console.log('Host joined:', data);
    });

    socket.on('host:teamJoined', (data) => {
      console.log('Team joined:', data);
      setGame(prev => {
        const newTeams = {};
        data.teams.forEach(team => {
          newTeams[team.name] = {
            name: team.name,
            score: team.score,
            usedConfidences: team.usedConfidences || [],
            answers: prev?.teams?.[team.name]?.answers || {}
          };
        });
        return { ...prev, teams: newTeams };
      });
    });

    socket.on('host:answerReceived', ({ teamName, questionKey, answerText, confidence }) => {
      console.log('Answer received:', teamName, questionKey);
      setGame(prev => ({
        ...prev,
        teams: {
          ...prev.teams,
          [teamName]: {
            ...prev.teams[teamName],
            answers: {
              ...prev.teams[teamName]?.answers,
              [questionKey]: {
                text: answerText,
                confidence,
                marked: false,
                correct: false
              }
            }
          }
        }
      }));
    });
socket.on('host:wagerReceived', (data) => {
  setGame(prev => ({
    ...prev,
    teams: data.teams.reduce((acc, team) => {
      acc[team.name] = team;
      return acc;
    }, {})
  }));
  console.log(`Wager received from ${data.teamName}: ${data.wager}`);
});

socket.on('host:questionPushed', () => {
  setScreen('scoring');
});

socket.on('host:scoresCorrected', (data) => {
  setGame(prev => ({
    ...prev,
    teams: data.teams.reduce((acc, team) => {
      acc[team.name] = {
        ...prev.teams[team.name],
        score: team.score
      };
      return acc;
    }, {})
  }));
});

return () => {
  socket.off('host:joined');
  socket.off('host:teamJoined');
  socket.off('host:answerReceived');
  socket.off('host:wagerReceived');
  socket.off('host:questionPushed');
  socket.off('host:scoresCorrected');
};

  }, [socket, gameCode]);

  const createGame = async () => {
    if (!hostName || !venueName) {
      alert('Please enter host name and venue name');
      return;
    }

    try {
      const response = await fetch(BACKEND_URL + '/api/game/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
       setGameCode(data.gameCode);
       setGame({ hostName, venueName, venueSpecials, teams: {} });

     socket.emit('host:join', data.gameCode);
     socket.emit('host:setup', {
      gameCode: data.gameCode,
      hostName,
      venueName,
      venueSpecials
     });
    setScreen('questions');
    } catch (error) {
      alert('Failed to create game');
      console.error(error);
    }
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
  };

  const downloadTemplate = () => {
    const template = `Category,Question,Answer
Science,What is H2O?,Water
History,Who was the first president?,George Washington
Sports,How many players on a basketball team?,Five
Geography,What is the capital of France?,Paris
Math,What is 2+2?,Four
Arts,Who painted the Mona Lisa?,Leonardo da Vinci
Science,What planet is known as the Red Planet?,Mars
History,In what year did World War II end?,1945
Sports,How many points is a touchdown in American football?,Six
Geography,What is the largest ocean?,Pacific Ocean
Math,What is the square root of 144?,Twelve
Arts,Who wrote Romeo and Juliet?,William Shakespeare
Science,What is the speed of light?,299792458 meters per second
History,Who discovered America?,Christopher Columbus
Sports,How many innings in a baseball game?,Nine
General,Final Question Example?,Final Answer Example`;
    
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quizzler_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleImportCSV = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const imported = results.data;
        const newQuestions = [...questions];
        
        // Fill regular questions (first 15)
        for (let i = 0; i < Math.min(15, imported.length); i++) {
          if (imported[i].Category && imported[i].Question && imported[i].Answer) {
            newQuestions[i] = {
              category: imported[i].Category,
              question: imported[i].Question,
              answer: imported[i].Answer
            };
          }
        }
        
        // Fill final question if there's a 16th row
        if (imported.length >= 16 && imported[15].Category && imported[15].Question && imported[15].Answer) {
          setFinalQuestion({
            category: imported[15].Category,
            question: imported[15].Question,
            answer: imported[15].Answer
          });
        }
        
        setQuestions(newQuestions);
        alert(`Imported ${Math.min(imported.length, 16)} questions successfully!`);
      },
      error: (error) => {
        alert('Error parsing CSV: ' + error.message);
      }
    });
    
    // Reset file input
    event.target.value = '';
  };

  const startGame = () => {
    const validQuestions = questions.filter(q => q.question && q.answer);
    if (validQuestions.length < 15) {
      alert('Please fill in all 15 questions and answers');
      return;
    }
    
    // Send each question to the backend
    validQuestions.forEach(q => {
      socket.emit('host:addQuestion', {
        gameCode,
        question: {
          text: q.question,
          answer: q.answer
        }
      });
    });
    
    setGame(prev => ({ ...prev, questions: validQuestions }));
    setScreen('welcome');
  };

  const continueToFirstQuestion = () => {
  setGame(prev => ({ ...prev, currentQuestionIndex: 0 }));
  setScreen('questionDisplay'); // Show Q1 on host screen
};

  const pushQuestion = () => {
  const questionIndex = game.currentQuestionIndex;
  socket.emit('host:pushQuestion', { gameCode, questionIndex });
  // Removed setScreen - will change on backend confirmation
};

const toggleCorrectness = (teamName, questionKey) => {
  socket.emit('host:toggleCorrectness', { gameCode, teamName, questionKey });
};

const viewTeamHistory = (teamName) => {
  const team = game.teams[teamName];
  setSelectedTeamHistory({ teamName, team });
};

const closeHistory = () => {
  setSelectedTeamHistory(null);
};

  const markAnswer = (teamName, correct) => {
    const questionKey = game.status === 'final' ? 'final' : `q${game.currentQuestionIndex + 1}`;
    socket.emit('host:markAnswer', { gameCode, teamName, questionKey, correct });

    const team = game.teams[teamName];
    const answer = team.answers[questionKey];
    let scoreChange = 0;
    
    if (game.status === 'final') {
      scoreChange = correct ? answer.confidence : -answer.confidence;
    } else {
      scoreChange = correct ? answer.confidence : 0;
    }

    setGame(prev => ({
      ...prev,
      teams: {
        ...prev.teams,
        [teamName]: {
          ...prev.teams[teamName],
          score: prev.teams[teamName].score + scoreChange,
          answers: {
            ...prev.teams[teamName].answers,
            [questionKey]: { ...answer, marked: true, correct }
          }
        }
      }
    }));
  };

const nextQuestion = () => {
  const nextIndex = game.currentQuestionIndex + 1;
  
  if (nextIndex >= 15) {
    setGame(prev => ({ ...prev, status: 'final' }));
    setScreen('finalQuestionDisplay');
    return;
  }
  
  setGame(prev => ({ ...prev, currentQuestionIndex: nextIndex }));
  setScreen('questionDisplay'); // Show next question on host screen
};


const pushFinalCategory = () => {
socket.emit('host:pushFinalCategory', { 
    gameCode, 
    category: finalQuestion.category 
});
setScreen('waitingForWagers');
};

const revealFinalQuestion = () => {
  socket.emit('host:revealFinalQuestion', { 
    gameCode,
    question: finalQuestion.question,
    answer: finalQuestion.answer
  });
  setScreen('finalScoring');
};

  const endGame = () => {
    socket.emit('host:endGame', { gameCode });
    setScreen('endGame');
  };

  const pushFinalRankings = () => {
  socket.emit('host:pushFinalRankings', { gameCode });
  alert('Final rankings sent to all teams!');
};

// Add this helper function near the top with other functions like getSortedTeams
const getScoringProgress = () => {
  if (!game?.teams) return { scored: 0, total: 0 };
  const questionKey = game.status === 'final' ? 'final' : `q${game.currentQuestionIndex + 1}`;
  let scored = 0;
  let total = 0;
  
  Object.values(game.teams).forEach(team => {
    const answer = team.answers?.[questionKey];
    if (answer) {
      total++;
      if (answer.marked) scored++;
    }
  });
  
  return { scored, total };
};

  const getSortedTeams = () => {
    if (!game?.teams) return [];
    return Object.values(game.teams).sort((a, b) => b.score - a.score);
  };

  return (
    <div className="quizzler-host">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Paytone+One&family=Gabarito:wght@400;500;600;700&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Gabarito', sans-serif;
          background: #F5F5F5;
        }

        .quizzler-host {
          min-height: 100vh;
        }

        .header {
          background: linear-gradient(135deg, #FFFFCC 0%, #FFFF99 50%, #FFFF66 100%);
          padding: 30px 50px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          border-radius: 0 0 30px 30px;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .logo-icon {
          width: 50px;
          height: 50px;
        }

        .logo-text {
          font-family: 'Gabarito', sans-serif;
          font-size: 42px;
          color: #FF6600;
          letter-spacing: 2px;
        }

        .host-info {
          color: #286586;
          font-size: 18px;
          font-weight: 600;
        }

        .main-content {
          display: flex;
          gap: 30px;
          padding: 40px 50px;
          max-width: 1800px;
          margin: 0 auto;
        }

        .left-panel {
          flex: 1;
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .right-panel {
          width: 350px;
          background: white;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .teams-header {
          color: #286586;
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 20px;
          text-align: center;
          border-bottom: 3px solid #286586;
          padding-bottom: 10px;
        }

        .team-item {
          color: #286586;
          font-size: 16px;
          padding: 12px 0;
          border-bottom: 1px solid #E0E0E0;
          display: flex;
          justify-content: space-between;
        }

        .team-score {
          font-weight: 700;
          color: #FF6600;
        }

        .center-screen {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 40px;
        }

        .start-button {
          padding: 20px 60px;
          background: #32ADE6;
          color: #FFFFFF;
          font-size: 22px;
          font-weight: 600;
          font-family: 'Gabarito', sans-serif;
          border: none;
          border-radius: 30px;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 4px 15px rgba(50, 173, 230, 0.3);
        }

        .start-button:hover {
          background: #2894C7;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(50, 173, 230, 0.4);
        }

        .form-label {
          color: #286586;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 10px;
          display: block;
        }

        .input-field {
          width: 100%;
          max-width: 500px;
          padding: 15px;
          font-size: 16px;
          font-family: 'Gabarito', sans-serif;
          border: 2px solid #286586;
          border-radius: 10px;
          margin-bottom: 20px;
        }

        .textarea-field {
          width: 100%;
          max-width: 500px;
          padding: 15px;
          font-size: 16px;
          font-family: 'Gabarito', sans-serif;
          border: 2px solid #286586;
          border-radius: 10px;
          margin-bottom: 20px;
          min-height: 120px;
          resize: vertical;
        }

        .submit-button {
          padding: 15px 40px;
          background: #32ADE6;
          color: #FFFFFF;
          font-size: 18px;
          font-weight: 600;
          font-family: 'Gabarito', sans-serif;
          border: none;
          border-radius: 25px;
          cursor: pointer;
          transition: all 0.3s;
        }

        .submit-button:hover {
          background: #2894C7;
          transform: translateY(-2px);
        }

        .questions-grid {
          display: grid;
          gap: 25px;
          max-height: 600px;
          overflow-y: auto;
          margin-bottom: 30px;
        }

        .question-group {
          display: grid;
          gap: 10px;
        }

        .question-label {
          color: #286586;
          font-size: 14px;
          font-weight: 600;
        }

        .question-input {
          padding: 10px;
          font-size: 14px;
          font-family: 'Gabarito', sans-serif;
          border: 1px solid #CCC;
          border-radius: 8px;
        }

        .section-title {
          color: #286586;
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 30px;
        }

        .welcome-script {
          color: #286586;
          font-size: 18px;
          line-height: 1.8;
          margin-bottom: 30px;
        }

        .question-display {
          color: #286586;
          font-size: 24px;
          margin-bottom: 20px;
          line-height: 1.6;
        }

        .answer-item {
          background: #F8F8F8;
          border: 2px solid #E0E0E0;
          border-radius: 15px;
          padding: 20px;
          margin-bottom: 15px;
        }

        .answer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .team-name-large {
          color: #286586;
          font-size: 20px;
          font-weight: 700;
        }

        .answer-buttons {
          display: flex;
          gap: 10px;
        }

        .correct-button {
          padding: 10px 20px;
          background: #00AA00;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
          cursor: pointer;
          font-weight: 600;
        }

        .incorrect-button {
          padding: 10px 20px;
          background: #C60404;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
          cursor: pointer;
          font-weight: 600;
        }

        .answer-details {
          color: #286586;
          font-size: 16px;
          line-height: 1.6;
        }

        .continue-button {
          width: 100%;
          max-width: 400px;
          padding: 18px;
          background: #32ADE6;
          color: #FFFFFF;
          font-size: 20px;
          font-weight: 600;
          font-family: 'Gabarito', sans-serif;
          border: none;
          border-radius: 25px;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 30px;
        }

        .continue-button:hover {
          background: #2894C7;
          transform: translateY(-2px);
        }

        .thank-you-text {
          color: #286586;
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 40px;
        }
      `}</style>

      {screen === 'start' && (
        <div className="center-screen">
          <div className="header" style={{ width: '100%', maxWidth: '1400px', marginBottom: '100px' }}>
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
          </div>
          <button className="start-button" onClick={() => setScreen('setup')}>
            START NEW GAME
          </button>
        </div>
      )}

      {screen === 'setup' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
          </div>
          <div style={{ padding: '60px', maxWidth: '600px', margin: '0 auto' }}>
            <label className="form-label">ENTER HOST NAME</label>
            <input
              type="text"
              className="input-field"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
            <label className="form-label">ENTER VENUE NAME</label>
            <input
              type="text"
              className="input-field"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
            <label className="form-label">ENTER VENUE SPECIALS</label>
            <textarea
              className="textarea-field"
              value={venueSpecials}
              onChange={(e) => setVenueSpecials(e.target.value)}
            />
            <button className="submit-button" onClick={createGame}>
              SUBMIT
            </button>
          </div>
        </>
      )}

      {screen === 'questions' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">ENTER QUESTIONS</div>
              
              {/* CSV Import/Export Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button 
                  className="submit-button" 
                  onClick={downloadTemplate}
                  style={{ flex: 1 }}
                >
                  📥 Download Template
                </button>
                <label 
                  htmlFor="csv-upload" 
                  className="submit-button"
                  style={{ flex: 1, textAlign: 'center', cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  📤 Import CSV
                </label>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleImportCSV}
                  style={{ display: 'none' }}
                />
              </div>

              <div className="questions-grid">
                {questions.map((q, idx) => (
                  <div key={idx} className="question-group">
                    <label className="question-label">Category {idx + 1}</label>
                    <input
                      className="question-input"
                      value={q.category}
                      onChange={(e) => updateQuestion(idx, 'category', e.target.value)}
                    />
                    <label className="question-label">Question {idx + 1}</label>
                    <input
                      className="question-input"
                      value={q.question}
                      onChange={(e) => updateQuestion(idx, 'question', e.target.value)}
                    />
                    <label className="question-label">Answer {idx + 1}</label>
                    <input
                      className="question-input"
                      value={q.answer}
                      onChange={(e) => updateQuestion(idx, 'answer', e.target.value)}
                    />
                  </div>
                ))}
                <div className="question-group">
                  <label className="question-label">FINAL CATEGORY</label>
                  <input
                    className="question-input"
                    value={finalQuestion.category}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, category: e.target.value }))}
                  />
                  <label className="question-label">FINAL QUESTION</label>
                  <input
                    className="question-input"
                    value={finalQuestion.question}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, question: e.target.value }))}
                  />
                  <label className="question-label">FINAL ANSWER</label>
                  <input
                    className="question-input"
                    value={finalQuestion.answer}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, answer: e.target.value }))}
                  />
                </div>
              </div>
              <button className="submit-button" onClick={startGame}>
                START
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
  <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
))}
              {getSortedTeams().length === 0 && (
                <p style={{ color: '#999', textAlign: 'center' }}>Waiting for teams...</p>
              )}
            </div>
          </div>
        </>
      )}

      {screen === 'welcome' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="welcome-script">
                Welcome to Quizzler Trivia at {venueName}! I'm your host {hostName}.
                <br/><br/>
                While we wait for all of the teams to join, let me tell you about our drink specials tonight.
                <br/><br/>
                {venueSpecials}
                <br/><br/>
                OK...I'm going to run through the rules of the game.
                <br/><br/>
                We have 15 questions from various categories. Those questions will be sent to your device. Each question has to have a confidence score from 1 to 15, but you can only use each number one time. If you are very confident in your answer, give it higher points. Lower confidence, lower points. Get it? You get 2 minutes to answer each question.
                <br/><br/>
                You will be able to see your current score after each question. I'll give you team standings at various points throughout the game.
                <br/><br/>
                At the end of the 15 rounds, we will have a final question where you can wager up to 20pts. If you get the final answer correct, your wager will be added to your final score. However, if you get it wrong, the wager will be deducted from your final score. Before you get the final answer, I will give you the category and give you a moment to put in your wager. Once all wagers are in, I will send you the final question.
                <br/><br/>
                Winners will get $20 and the second place team will get $10. Second to last place will receive $5.
                <br/><br/>
                Any question? OK! Let's get started!
              </div>
              {(() => {
  const { scored, total } = getScoringProgress();
  const allScored = scored === total && total > 0;
  const nextQuestionNum = game.currentQuestionIndex + 2;
  
  return (
    <button className="continue-button" onClick={continueToFirstQuestion}>
  CONTINUE
</button>
  );
})()}
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'questionDisplay' && game?.currentQuestionIndex !== undefined && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
                Question {game.currentQuestionIndex + 1}...
                <br/><br/>
                The category is {questions[game.currentQuestionIndex].category}
                <br/><br/>
                {questions[game.currentQuestionIndex].question}
              </div>
             <button 
  onClick={pushQuestion}
  className="submit-button"
>
  PUSH TO TEAMS
</button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'scoring' && game?.currentQuestionIndex !== undefined && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">TEAM ANSWERS FOR QUESTION {game.currentQuestionIndex + 1}</div>
              <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '10px', marginBottom: '10px' }}>
  <strong style={{ color: '#286586' }}>Question:</strong> {questions[game.currentQuestionIndex].question}
</div>
<div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
  <strong style={{ color: '#286586' }}>Correct answer:</strong> {questions[game.currentQuestionIndex].answer}
</div>
              {getSortedTeams().map(team => {
                const questionKey = `q${game.currentQuestionIndex + 1}`;
                const answer = team.answers?.[questionKey];
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div className="team-name-large">{team.name} | {team.score} pts</div>
                      {answer && !answer.marked && (
                        <div className="answer-buttons">
                          <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
                          <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
                        </div>
                      )}
                    </div>
                    {answer ? (
                      <div className="answer-details">
                        Their answer: "{answer.text}"<br/>
                        Confidence: {answer.confidence} pts
                        {answer.marked && (
                          <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
                            {answer.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#999', fontStyle: 'italic' }}>Waiting for answer...</div>
                    )}
                  </div>
                );
              })}
              {(() => {
  			const { scored, total } = getScoringProgress();
  			const allScored = scored === total && total > 0;
  			const nextQuestionNum = game.currentQuestionIndex + 2;
  
  			return (
    			<button 
    			className="continue-button"
                onClick={nextQuestion}
                disabled={!allScored}
                style={{
                opacity: allScored ? 1 : 0.5,
                cursor: allScored ? 'pointer' : 'not-allowed'
              }}
               >
      {!allScored 
        ? `Scored ${scored} of ${total} teams - Score remaining to continue` 
        : `ON TO QUESTION ${nextQuestionNum}`}
    </button>
  );
})()}
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'finalQuestionDisplay' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
                FINAL QUESTION...
                <br/><br/>
                The category is {finalQuestion.category}
                <br/><br/>
                {finalQuestion.question}
              </div>
              <button className="submit-button" onClick={pushFinalCategory}>
  PUSH CATEGORY (PLAYERS WAGER)
</button>


            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>

      )}

{screen === 'waitingForWagers' && (
  <>
    <div className="header">
      <div className="logo">
        <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
        
      </div>
      <div className="host-info">
        {hostName} | {venueName} | {gameCode}
      </div>
    </div>
    <div className="main-content">
      <div className="left-panel">
        <div className="question-display">
          <div className="question-number">WAITING FOR WAGERS...</div>
          Teams are submitting their wagers (0-20 points) based on the category: {finalQuestion.category}
          <br/><br/>
          Once all teams have submitted, reveal the question below:
          <br/><br/>
          {finalQuestion.question}
        </div>
        <button className="submit-button" onClick={revealFinalQuestion}>
          REVEAL FINAL QUESTION TO TEAMS
        </button>
      </div>
      <div className="right-panel">
        <div className="teams-header">TEAMS</div>
        {getSortedTeams().map((team, idx) => (
          <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
        ))}
      </div>
    </div>
  </>
)}

      {screen === 'finalScoring' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">FINAL QUESTION ANSWERS</div>
              <div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                <strong style={{ color: '#286586' }}>Correct answer:</strong> {finalQuestion.answer}
              </div>
              {getSortedTeams().map(team => {
                const answer = team.answers?.['final'];
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div className="team-name-large">{team.name} | {team.score} pts</div>
                      {answer && !answer.marked && (
                        <div className="answer-buttons">
                          <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
                          <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
                        </div>
                      )}
                    </div>
                    {answer ? (
                      <div className="answer-details">
                        Their answer: "{answer.text}"<br/>
                        Wager: {answer.confidence} pts
                        {answer.marked && (
                          <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
                            {answer.correct ? `✓ CORRECT (+${answer.confidence} pts)` : `✗ INCORRECT (-${answer.confidence} pts)`}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#999', fontStyle: 'italic' }}>Waiting for answer...</div>
                    )}
                  </div>
                );
              })}
              <button className="continue-button" onClick={endGame}>
                END GAME
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'endGame' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
              
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="thank-you-text">
                Thanks for playing everyone! See you next week!
              </div>
              <button className="submit-button" onClick={pushFinalRankings}>
                PUSH FINAL RANKING TO ALL TEAMS
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
    <div>
      <span>{idx + 1}. {team.name}</span>
      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
    </div>
    <button
      onClick={() => viewTeamHistory(team.name)}
      style={{
        background: '#FF6600',
        color: 'white',
        border: 'none',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer'
      }}
    >
      History
    </button>
  </div>
</div>
              ))}
            </div>
          </div>
        </>
      )}
      {/* Team History Modal */}
{selectedTeamHistory && (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  }}>
    <div style={{
      background: 'white',
      borderRadius: '20px',
      padding: '40px',
      maxWidth: '800px',
      maxHeight: '80vh',
      overflow: 'auto',
      boxShadow: '0 10px 50px rgba(0,0,0,0.5)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h2 style={{ color: '#286586', fontSize: '28px', margin: 0 }}>
          {selectedTeamHistory.teamName} - Answer History
        </h2>
        <button 
          onClick={closeHistory}
          style={{
            background: '#FF6B6B',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            fontSize: '24px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          ×
        </button>
      </div>

      <div style={{ marginBottom: '20px', padding: '15px', background: '#E3F2FD', borderRadius: '10px' }}>
        <div style={{ fontSize: '18px', color: '#286586' }}>
          <strong>Current Score:</strong> {selectedTeamHistory.team.score} points
        </div>
      </div>

      {Object.entries(selectedTeamHistory.team.answers || {}).map(([questionKey, answer]) => {
        const questionNum = questionKey === 'final' ? 'Final' : questionKey.replace('q', '');
        const question = questionKey === 'final' 
          ? finalQuestion 
          : questions[parseInt(questionNum) - 1];
        
        return (
          <div key={questionKey} style={{
            background: answer.correct ? '#E8F5E9' : '#FFEBEE',
            border: `2px solid ${answer.correct ? '#4CAF50' : '#F44336'}`,
            borderRadius: '10px',
            padding: '20px',
            marginBottom: '15px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#286586', marginBottom: '5px' }}>
                  Question {questionNum}
                </div>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                  {question?.question || 'Question text not available'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14px', color: '#666' }}>Confidence</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF6600' }}>
                  {answer.confidence}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Their Answer:</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{answer.text}</div>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Correct Answer:</div>
              <div style={{ fontSize: '16px', color: '#4CAF50', fontWeight: 'bold' }}>
                {question?.answer || 'N/A'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: answer.correct ? '#2E7D32' : '#C62828'
              }}>
                {answer.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                {answer.correct ? ` (+${answer.confidence} pts)` : ' (+0 pts)'}
              </div>
              <button
                onClick={() => toggleCorrectness(selectedTeamHistory.teamName, questionKey)}
                style={{
                  background: answer.correct ? '#F44336' : '#4CAF50',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Mark as {answer.correct ? 'Incorrect' : 'Correct'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}
    </div>
  );
}