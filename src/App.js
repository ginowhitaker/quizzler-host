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
  const [regularTimer, setRegularTimer] = useState(0); // 0 = no timer
  const [visualTimer, setVisualTimer] = useState(0); // 0 = no timer
  const [gameCode, setGameCode] = useState('');
  const [game, setGame] = useState({
    code: '',
    currentQuestionIndex: 0,
    questionNumber: 0
  });
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  // FIXED: Changed 'question' to 'text' to match PostgreSQL schema
  const [questions, setQuestions] = useState(Array.from({ length: 15 }, () => ({ 
    category: '', 
    text: '',  // FIXED: was 'question'
    answer: '', 
    type: 'regular', 
    imageUrl: '' 
  })));
  const [finalQuestion, setFinalQuestion] = useState({ category: '', question: '', answer: '' });
  const [selectedTeamHistory, setSelectedTeamHistory] = useState(null);
  const [timerDuration, setTimerDuration] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [resumeGameCode, setResumeGameCode] = useState('');

    useEffect(() => {
  const newSocket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });
  
  setSocket(newSocket);
  
  newSocket.on('connect', () => {
    console.log('Connected to server');
    
    if (gameCode) {
      console.log('Rejoining game:', gameCode);
      newSocket.emit('host:join', gameCode);
      
      // SYNC GAME STATE from database
      fetch(`${BACKEND_URL}/api/game/${gameCode}`)
        .then(res => res.json())
        .then(gameData => {
          console.log('Synced game state:', gameData);
          
          // Update current question index
          if (gameData.current_question_index !== undefined) {
            console.log('Setting question index to:', gameData.current_question_index);
            setSelectedQuestionIndex(gameData.current_question_index);
          }
          
          // Update teams with latest answers and scores
          if (gameData.teams) {
            setGame(prev => ({
              ...prev,
              currentQuestionIndex: gameData.current_question_index || 0,
              teams: gameData.teams.reduce((acc, team) => {
                acc[team.name] = {
                  name: team.name,
                  score: team.score,
                  usedConfidences: team.usedConfidences || [],
                  answers: team.answers || {}
                };
                return acc;
              }, {})
            }));
          }
        })
        .catch(err => console.error('Failed to sync game state:', err));
    }
  });  // ADDED: Close connect handler
  
  newSocket.on('disconnect', () => {
    console.log('Disconnected from backend - attempting to reconnect...');
  });
  
  newSocket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
  });
  
  newSocket.on('error', (error) => alert(error.message));
  
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
  console.log('Wager data received:', data);
  console.log('Teams structure:', data.teams);
  
  setGame(prev => ({
    ...prev,
    teams: data.teams.reduce((acc, team) => {
      console.log('Processing team:', team.name, 'answers:', team.answers);
      acc[team.name] = team;
      return acc;
    }, {})
  }));
  console.log(`Wager received from ${data.teamName}: ${data.wager}`);
});
    socket.on('host:questionPushed', (data) => {
      console.log('Question pushed successfully');
      
      // Initialize timer if present
      if (data.timerDuration && data.timerDuration > 0) {
        setTimerDuration(data.timerDuration);
        setTimeRemaining(data.timerDuration);
        setTimerActive(true);
      } else {
        setTimerActive(false);
      }
      
      setScreen('scoring');
    });

    socket.on('host:scoresCorrected', (data) => {
      setGame(prev => {
        const updatedTeams = {};
        
        // Rebuild teams object completely to ensure React detects changes
        Object.keys(prev.teams).forEach(teamName => {
          const teamData = data.teams.find(t => t.name === teamName);
          
          if (teamData) {
            updatedTeams[teamName] = {
              ...prev.teams[teamName],
              score: teamData.score,
              answers: teamData.answers ? { ...teamData.answers } : prev.teams[teamName].answers
            };
          } else {
            updatedTeams[teamName] = prev.teams[teamName];
          }
        });
        
        return {
          ...prev,
          teams: updatedTeams
        };
      });
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

  // Timer countdown
  useEffect(() => {
    if (!timerActive || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          setTimerActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerActive, timeRemaining]);

  // Prevent accidental navigation away
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (game && gameCode) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [game, gameCode]);

  const formatTimer = () => {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

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
        venueSpecials,
        regularTimer,
        visualTimer
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
  const headers = ['Category', 'Question', 'Answer', 'Type', 'Image URL'];
  const rows = [
    // Questions 1-7
    ['Science', 'What is H2O?', 'Water', 'regular', ''],
    ['History', 'Who was the first president?', 'George Washington', 'regular', ''],
    ['Sports', 'How many players on a basketball team?', '5', 'regular', ''],
    ['Geography', 'What is the capital of France?', 'Paris', 'regular', ''],
    ['Pop Culture', 'Who played Iron Man in the MCU?', 'Robert Downey Jr.', 'regular', ''],
    ['Music', 'What band released "Bohemian Rhapsody"?', 'Queen', 'regular', ''],
    ['Literature', 'Who wrote "1984"?', 'George Orwell', 'regular', ''],
    // Visual Round (after Q7)
    ['Logos', 'Name these 6 logos', 'Mitsubishi|Fila|Quaker|Wikipedia|NVIDIA|HBSC', 'visual', 'https://quizzler.pro/img/visual-102225.jpg'],
    // Questions 8-15
    ['Science', 'What planet is known as the Red Planet?', 'Mars', 'regular', ''],
    ['History', 'What year did World War II end?', '1945', 'regular', ''],
    ['Sports', 'Who has won the most Super Bowls?', 'Tom Brady', 'regular', ''],
    ['Geography', 'What is the largest ocean?', 'Pacific Ocean', 'regular', ''],
    ['Pop Culture', 'What streaming service created "Stranger Things"?', 'Netflix', 'regular', ''],
    ['Music', 'Who is known as the King of Pop?', 'Michael Jackson', 'regular', ''],
    ['Literature', 'What wizard school does Harry Potter attend?', 'Hogwarts', 'regular', ''],
    ['General', 'How many states are in the USA?', '50', 'regular', ''],
    // Final Question
    ['American History', 'In what year was the Declaration of Independence signed?', '1776', 'final', '']
  ];
  
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quizzler_template.csv';
  a.click();
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
      
      // Questions 1-7 (rows 0-6)
      for (let i = 0; i < 7 && i < imported.length; i++) {
        if (imported[i].Category && imported[i].Question && imported[i].Answer) {
          newQuestions[i] = {
            category: imported[i].Category,
            text: imported[i].Question,
            answer: imported[i].Answer,
            type: imported[i].Type || 'regular',
            imageUrl: imported[i]['Image URL'] || null
          };
        }
      }
      
      // Visual Round (row 7 - position 8 in template)
      if (imported.length > 7 && imported[7].Type === 'visual') {
        newQuestions[7] = {
          category: imported[7].Category,
          text: imported[7].Question,
          answer: imported[7].Answer,
          type: 'visual',
          imageUrl: imported[7]['Image URL'] || null
        };
      }
      
      // Questions 8-15 (rows 8-14)
      for (let i = 8; i <= 15 && i < imported.length; i++) {
        if (imported[i].Category && imported[i].Question && imported[i].Answer) {
          newQuestions[i] = {
            category: imported[i].Category,
            text: imported[i].Question,
            answer: imported[i].Answer,
            type: imported[i].Type || 'regular',
            imageUrl: imported[i]['Image URL'] || null
          };
        }
      }
      
      // Final question (row 15)
      if (imported.length >= 16 && imported[15].Category && imported[15].Question && imported[15].Answer) {
        setFinalQuestion({
          category: imported[15].Category,
          question: imported[15].Question,
          answer: imported[15].Answer,
          type: imported[15].Type || 'final',
          imageUrl: imported[15]['Image URL'] || null
        });
      }
      
      setQuestions(newQuestions);
      alert(`Successfully imported 15 questions + 1 visual round + 1 final question!`);
    },
    error: (error) => {
      alert('Error parsing CSV: ' + error.message);
    }
  });
  
  event.target.value = '';
};

  const startGame = async () => {
    // FIXED: Check for 'text' field instead of 'question'
    const validQuestions = questions.filter(q => q.text && q.answer);
    if (validQuestions.length < 15) {
      alert('Please fill in all 15 questions and answers');
      return;
    }
    
// Send ALL questions at once to avoid race condition
socket.emit('host:addAllQuestions', {
  gameCode,
  questions: validQuestions
});
    
    // Wait a bit for all questions to be saved, then fetch game state
    setTimeout(() => {
      fetch(`${BACKEND_URL}/api/game/${gameCode}`)
        .then(res => res.json())
        .then(gameData => {
          console.log('Fetched game data:', gameData);
          setQuestions(gameData.questions || []);
          setSelectedQuestionIndex(0);  // FIXED: Reset to 0 when starting
          setGame(prev => ({ ...prev, questions: gameData.questions }));
          setScreen('welcome');
        })
        .catch(err => {
          console.error('Error fetching game:', err);
          setScreen('welcome');
        });
    }, 1000);
  };

  const continueToFirstQuestion = () => {
    setSelectedQuestionIndex(0);  // FIXED: Reset to 0
    setGame(prev => ({ ...prev, currentQuestionIndex: 0 }));
    setScreen('questionDisplay');
  };

  const pushQuestion = () => {
    console.log('Pushing question with index:', selectedQuestionIndex);
    console.log('Question details:', questions[selectedQuestionIndex]);
    socket.emit('host:pushQuestion', { gameCode, questionIndex: selectedQuestionIndex });
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
  const questionKey = game.status === 'final' ? 'final' : `q${selectedQuestionIndex + 1}`;
  console.log('Marking answer - questionKey:', questionKey, 'selectedQuestionIndex:', selectedQuestionIndex);  
  const team = game.teams[teamName];
  const answer = team.answers[questionKey];

  
  // TEMPORARILY COMMENTED OUT FOR DEBUGGING
  // if (!answer || answer.marked) {
  //   console.log('Answer already marked, ignoring click');
  //   return;
  // }
  
  socket.emit('host:markAnswer', { gameCode, teamName, questionKey, correct });

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

  const markVisualAnswer = (teamName, index, correct) => {
  const questionKey = questions[selectedQuestionIndex]?.type === 'visual' 
    ? 'visual' 
    : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
  console.log('Marking visual answer - questionKey:', questionKey, 'index:', index, 'correct:', correct);
  
  const team = game.teams[teamName];
  const answer = team.answers[questionKey];
    
    if (!Array.isArray(answer.correct)) {
      answer.correct = [null, null, null, null, null, null];
    }
    
    answer.correct[index] = correct;
    
    setGame(prev => ({
      ...prev,
      teams: {
        ...prev.teams,
        [teamName]: {
          ...prev.teams[teamName],
          answers: {
            ...prev.teams[teamName].answers,
            [questionKey]: { ...answer }
          }
        }
      }
    }));
    
    const allMarked = answer.correct.every(val => val !== null);
    
    if (allMarked) {
      answer.marked = true;
      socket.emit('host:markAnswer', { 
        gameCode, 
        teamName, 
        questionKey, 
        correct: answer.correct 
      });
      
      const scoreChange = answer.correct.filter(val => val === true).length;
      
      setGame(prev => ({
        ...prev,
        teams: {
          ...prev.teams,
          [teamName]: {
            ...prev.teams[teamName],
            score: prev.teams[teamName].score + scoreChange,
            answers: {
              ...prev.teams[teamName].answers,
              [questionKey]: { ...answer, marked: true }
            }
          }
        }
      }));
    }
  };

  const nextQuestion = () => {
  // VALIDATION: Check if all answers are scored before advancing
  const { scored, total } = getScoringProgress();
  
  if (scored < total) {
    alert(`Please score all ${total} team answers before continuing. (${scored}/${total} scored)`);
    return;
  }
  
  // NEW: Check if all teams have submitted answers
  const currentQ = `q${selectedQuestionIndex + 1}`;
  const teamsWithoutAnswers = getSortedTeams().filter(team => !team.answers?.[currentQ]);
  
  if (teamsWithoutAnswers.length > 0) {
    const teamNames = teamsWithoutAnswers.map(t => t.name).join(', ');
    const confirmed = window.confirm(
      `${teamsWithoutAnswers.length} team(s) haven't submitted answers yet: ${teamNames}\n\n` +
      `Are you sure you want to proceed? Their answers will be marked incorrect.`
    );
    if (!confirmed) return;
  }
  
  const nextIndex = selectedQuestionIndex + 1;
  
  if (nextIndex >= 15) {
    setGame(prev => ({ ...prev, status: 'final' }));
    setScreen('finalQuestionDisplay');
    return;
  }
  
  setSelectedQuestionIndex(nextIndex);
  setScreen('questionDisplay');
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
          background-image: url(https://quizzler.pro/img/quizzler-background.png);
          background-repeat: no-repeat;
          background-size: cover;
          background-position: center;
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
        }

        .team-item {
          background: #F5F5F5;
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .team-score {
          color: #FF6600;
          font-weight: 700;
        }

        .section-title {
          color: #286586;
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 30px;
          text-align: center;
        }

        .input-field {
          width: 100%;
          padding: 15px;
          margin-bottom: 15px;
          border: 2px solid #E0E0E0;
          border-radius: 10px;
          font-size: 16px;
          font-family: 'Gabarito', sans-serif;
        }

        .input-field:focus {
          outline: none;
          border-color: #FF6600;
        }

        .submit-button {
          width: 100%;
          padding: 18px;
          background: #FF6600;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 20px;
          font-weight: 700;
          font-family: 'Gabarito', sans-serif;
          cursor: pointer;
          margin-top: 0px;
          transition: background 0.3s;
        }

        .submit-button:hover {
          background: #E65C00;
        }

        .continue-button {
          width: 100%;
          padding: 18px;
          background: #00AA00;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 20px;
          font-weight: 700;
          font-family: 'Gabarito', sans-serif;
          cursor: pointer;
          margin-top: 30px;
          transition: background 0.3s;
        }

        .continue-button:hover:not(:disabled) {
          background: #009900;
        }

        .continue-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .questions-grid {
          margin-bottom: 20px;
        }

        .question-group {
          margin-bottom: 10px;
        }
        
        .round-label {
         display: block;
         color: #286586;
         font-size: 22px;
         font-weight: 800;
         margin-bottom: 8px;
         margin-top: 10px;
        }

        .question-label {
          display: block;
          color: #286586;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
          margin-top: 10px;
        }

        .question-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #E0E0E0;
          border-radius: 8px;
          font-size: 14px;
          font-family: 'Gabarito', sans-serif;
        }

        .question-input:focus {
          outline: none;
          border-color: #FF6600;
        }

        .welcome-script {
          font-size: 18px;
          line-height: 1.8;
          color: #333;
          padding: 20px;
          background: #FFF9E6;
          border-radius: 15px;
          margin-bottom: 30px;
        }

        .question-display {
          font-size: 28px;
          line-height: 1.6;
          color: #286586;
          padding: 30px;
          background: #E3F2FD;
          border-radius: 15px;
          margin-bottom: 30px;
          text-align: center;
          font-weight: 600;
        }

        .answer-item {
          background: #F5F5F5;
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 15px;
        }

        .answer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }

        .team-name-large {
          font-size: 20px;
          font-weight: 700;
          color: #286586;
        }

        .answer-buttons {
          display: flex;
          gap: 10px;
        }

        .correct-button, .incorrect-button {
          width: 50px;
          height: 50px;
          border: none;
          border-radius: 8px;
          font-size: 24px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .correct-button {
          background: #00AA00;
          color: white;
        }

        .incorrect-button {
          background: #C60404;
          color: white;
        }

        .correct-button:hover, .incorrect-button:hover {
          transform: scale(1.1);
        }

        .answer-details {
          font-size: 16px;
          color: #333;
        }

        .leaderboard-item {
          background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .leaderboard-rank {
          font-size: 36px;
          font-weight: 700;
          color: white;
        }

        .leaderboard-name {
          font-size: 24px;
          font-weight: 700;
          color: white;
        }

        .leaderboard-score {
          font-size: 28px;
          font-weight: 700;
          color: white;
        }

        .game-code-display {
          font-size: 72px;
          font-weight: 700;
          color: #FF6600;
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 20px;
          margin-bottom: 30px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        }
      `}</style>

      {screen === 'start' && (
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
          <div style={{ maxWidth: '600px', margin: '60px auto', padding: '40px' }}>
            <div className="section-title">HOST SETUP</div>
      
      
      
      {/* EXISTING NEW GAME SECTION */}
      <h3 style={{ color: '#286586', marginBottom: '15px' }}>Start New Game</h3>
              <input 
              className="input-field" 
              placeholder="Host Name"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
              <input 
              className="input-field" 
              placeholder="Venue Name"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
            <textarea 
              className="input-field" 
              placeholder="Venue Specials (optional)"
              value={venueSpecials}
              onChange={(e) => setVenueSpecials(e.target.value)}
              rows={4}
              style={{ resize: 'vertical' }}
            />
            <label className="question-label" style={{ marginTop: '20px' }}>Regular Question Timer:</label>
            <select 
              className="input-field"
              value={regularTimer}
              onChange={(e) => setRegularTimer(parseInt(e.target.value))}
              style={{ padding: '15px' }}
            >
              <option value={0}>No Timer</option>
              <option value={1}>1 Minute</option>
              <option value={2}>2 Minutes</option>
              <option value={3}>3 Minutes</option>
              <option value={4}>4 Minutes</option>
              <option value={5}>5 Minutes</option>
            </select>
            <label className="question-label">Visual Round Timer:</label>
            <select 
              className="input-field"
              value={visualTimer}
              onChange={(e) => setVisualTimer(parseInt(e.target.value))}
              style={{ padding: '15px' }}
            >
              <option value={0}>No Timer</option>
              <option value={1}>1 Minute</option>
              <option value={2}>2 Minutes</option>
              <option value={3}>3 Minutes</option>
              <option value={4}>4 Minutes</option>
              <option value={5}>5 Minutes</option>
            </select>
            <button className="submit-button" onClick={createGame}>
              SUBMIT
            </button>

            {/* COLLAPSIBLE RESUME SECTION AT BOTTOM */}
            <details style={{ marginTop: '40px', padding: '15px', background: '#F5F5F5', borderRadius: '10px', border: '1px solid #E0E0E0' }}>
              <summary style={{ 
                cursor: 'pointer', 
                fontWeight: 'bold', 
                color: '#286586', 
                fontSize: '16px',
                padding: '10px',
                listStyle: 'none'
              }}>
                RESUME EXISTING GAME
              </summary>
              <div style={{ marginTop: '15px' }}>
                <input 
  className="input-field" 
  placeholder="Enter Game Code (4 digits)"
  value={resumeGameCode}
  onChange={(e) => {
    setResumeGameCode(e.target.value.toUpperCase());
  }}
  maxLength={4}
/>
<button 
  className="submit-button" 
  onClick={async () => {
    if (!resumeGameCode || resumeGameCode.length !== 4) {
      alert('Please enter a valid 4-digit game code');
      return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/api/game/${resumeGameCode}`);
      const gameData = await response.json();
      
      if (!gameData) {
        alert('Game not found');
        return;
      }
      
               socket.emit('host:join', resumeGameCode);
               setGameCode(resumeGameCode); 
                      setHostName(gameData.host_name);
                      setVenueName(gameData.venue_name);
                      setVenueSpecials(gameData.venue_specials || '');
                      setQuestions(gameData.questions || []);
                      setSelectedQuestionIndex(gameData.current_question_index || 0);
                      setGame({ 
                        ...gameData, 
                        currentQuestionIndex: gameData.current_question_index || 0,
                        teams: {} 
                      });
                      
                      const teams = await fetch(`${BACKEND_URL}/api/game/${resumeGameCode}`).then(r => r.json());
                      if (teams.teams) {
                        const teamsMap = {};
                        teams.teams.forEach(team => {
                          teamsMap[team.name] = {
                            name: team.name,
                            score: team.score,
                            usedConfidences: team.usedConfidences || [],
                            answers: team.answers || {}
                          };
                        });
                        setGame(prev => ({ ...prev, teams: teamsMap }));
                      }
                      
                      if (gameData.status === 'final') {
                        setScreen('finalQuestionDisplay');
                      } else if (gameData.status === 'completed') {
                        setScreen('endGame');
                      } else if (gameData.question_number > 0) {
                        setScreen('scoring');
                      } else {
                        setScreen('welcome');
                      }
                    } catch (error) {
                      console.error('Error resuming game:', error);
                      alert('Failed to resume game');
                    }
                  }}
                  style={{ background: '#00AA00' }}
                >
                  RESUME GAME
                </button>
              </div>
            </details>

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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">ENTER QUESTIONS</div>
              
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button 
                  className="submit-button" 
                  onClick={downloadTemplate}
                  style={{ flex: 1 }}
                >
                  Download Template
                </button>
                <label 
                  htmlFor="csv-upload" 
                  className="submit-button"
                  style={{ flex: 1, textAlign: 'center', cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  Import CSV
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
    <div className="round-label">
      {idx === 7 ? 'VISUAL ROUND' : `Round ${idx < 7 ? idx + 1 : idx}`}
    </div>
    <label className="question-label">
      {idx === 7 ? 'Visual Round Category' : `Category ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.category}
      onChange={(e) => updateQuestion(idx, 'category', e.target.value)}
    />
    <label className="question-label">
      {idx === 7 ? 'Visual Round Question' : `Question ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.text}
      onChange={(e) => updateQuestion(idx, 'text', e.target.value)}
    />
    <label className="question-label">
      {idx === 7 ? 'Visual Round Answer' : `Answer ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.answer}
      onChange={(e) => updateQuestion(idx, 'answer', e.target.value)}
    />
    
    {idx === 7 && (
      <>
        <div style={{ 
          background: '#E3F2FD', 
          padding: '10px', 
          borderRadius: '5px',
          marginTop: '10px',
          marginBottom: '10px',
          color: '#286586',
          fontWeight: 'bold'
        }}>
          📸 VISUAL ROUND (appears after Q7)
        </div>
        <label className="question-label">Image URL</label>
        <input
          className="question-input"
          placeholder="https://quizzler.pro/img/visual-example.jpg"
          value={q.imageUrl || ''}
          onChange={(e) => updateQuestion(idx, 'imageUrl', e.target.value)}
        />
      </>
    )}
                    
                    {idx < 14 && (
                      <hr style={{ 
                        border: 'none', 
                        borderTop: '1px solid #cccccc', 
                        margin: '20px 0 0 0' 
                      }} />
                    )}
                  </div>
                ))}
                <div className="question-group">
                  <label className="round-label">FINAL CATEGORY</label>
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
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
                There is also a Visual Round where we will show you 6 images to identify. Each answer is worth 1 point for a possible total of 6 points for that round. 
                <br/><br/>
                You will be able to see your current score after each question. I'll give you team standings at various points throughout the game.
                <br/><br/>
                At the end of the 15 rounds, we will have a final question where you can wager up to 20pts. If you get the final answer correct, your wager will be added to your final score. However, if you get it wrong, the wager will be deducted from your final score. Before you get the final answer, I will give you the category and give you a moment to put in your wager. Once all wagers are in, I will send you the final question.
                <br/><br/>
                Winners will get $20 and the second place team will get $10. Second to last place will receive $5.
                <br/><br/>
                Any questions? OK! Let's get started!
              </div>
              <button className="continue-button" onClick={continueToFirstQuestion}>
                CONTINUE
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
  {questions[selectedQuestionIndex]?.type === 'visual' ? (
    <>
      VISUAL ROUND
      <br/><br/>
      The category is {questions[selectedQuestionIndex]?.category || 'N/A'}
      <br/><br/>
      {questions[selectedQuestionIndex]?.text}
    </>
  ) : (
    <>
      Question {selectedQuestionIndex < 7 ? selectedQuestionIndex + 1 : selectedQuestionIndex}...
      <br/><br/>
      The category is {questions[selectedQuestionIndex]?.category || 'N/A'}
      <br/><br/>
      {questions[selectedQuestionIndex]?.text}
    </>
  )}
</div>

<button 
  onClick={pushQuestion}
  className="submit-button"
>
  {questions[selectedQuestionIndex]?.type === 'visual' 
    ? 'PUSH VISUAL ROUND TO TEAMS'
    : `PUSH QUESTION ${selectedQuestionIndex < 7 ? selectedQuestionIndex + 1 : selectedQuestionIndex} TO TEAMS`
  }
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">TEAM ANSWERS FOR QUESTION {selectedQuestionIndex + 1}</div>
              <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '10px', marginBottom: '10px' }}>
                <strong style={{ color: '#286586' }}>Question:</strong> {questions[selectedQuestionIndex]?.text}
              </div>
              <div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                <strong style={{ color: '#286586' }}>Correct answer:</strong> {questions[selectedQuestionIndex]?.answer}
                {questions[selectedQuestionIndex]?.type === 'visual' && questions[selectedQuestionIndex]?.imageUrl && (
                  <div style={{ marginTop: '15px', textAlign: 'center' }}>
                    <img 
                      src={questions[selectedQuestionIndex].imageUrl} 
                      alt="Visual Question"
                      style={{ maxWidth: '300px', height: 'auto', borderRadius: '10px', border: '2px solid #286586' }}
                    />
                  </div>
                )}
              </div>
              {getSortedTeams().map(team => {
                const isVisual = questions[selectedQuestionIndex]?.type === 'visual';
                const questionKey = isVisual ? 'visual' : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
                const answer = team.answers?.[questionKey];
                
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div className="team-name-large">{team.name} | {team.score} pts</div>
                      {answer && !answer.marked && !isVisual && (
                        <div className="answer-buttons">
                          <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
                          <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
                        </div>
                      )}
                    </div>
                    {answer ? (
                      <div className="answer-details">
                        {isVisual ? (
                          <div>
                            {Array.isArray(answer.text) ? answer.text.map((ans, idx) => (
                              <div key={idx} style={{ marginBottom: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '5px' }}>
                                <strong>#{idx + 1}:</strong> {ans}
                                {!answer.marked && (
                                  <span style={{ marginLeft: '10px' }}>
                                    {answer.correct && answer.correct[idx] !== null ? (
                                      <span style={{ fontWeight: '700', color: answer.correct[idx] ? '#00AA00' : '#C60404' }}>
                                        {answer.correct[idx] ? '✓ CORRECT' : '✗ INCORRECT'}
                                      </span>
                                    ) : (
                                      <>
                                        <button 
                                          style={{ marginLeft: '5px', padding: '2px 8px', background: '#00AA00', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                          onClick={() => markVisualAnswer(team.name, idx, true)}
                                        >✓</button>
                                        <button 
                                          style={{ marginLeft: '5px', padding: '2px 8px', background: '#C60404', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                          onClick={() => markVisualAnswer(team.name, idx, false)}
                                        >✗</button>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                            )) : <div>Invalid answer format</div>}
                            {answer.marked && (
                              <div style={{ marginTop: '10px', fontWeight: '700', color: '#286586' }}>
                                Score: {answer.correct.filter(Boolean).length} / 6 points
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            Their answer: "{answer.text}"<br/>
                            Confidence: {answer.confidence} pts
                            {answer.marked && (
                              <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
                                {answer.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                              </div>
                            )}
                          </>
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
                const nextQuestionNum = selectedQuestionIndex + 2;
  
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
                <div className="question-number">WAITING FOR WAGERS...</div>
                Teams are submitting their wagers (0-20 points) based on the category: <strong>{finalQuestion.category}</strong>
              </div>

              <div style={{ marginTop: '30px' }}>
                {getSortedTeams().map(team => {
                  const wager = team.answers?.final?.confidence;
                  return (
                    <div key={team.name} style={{
                      background: wager !== undefined ? '#E8F5E9' : '#FFF9E6',
                      padding: '15px',
                      borderRadius: '10px',
                      marginBottom: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: '#286586' }}>
                        {team.name}
                      </span>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: wager !== undefined ? '#00AA00' : '#999' }}>
                        {wager !== undefined ? `Wager: ${wager} pts` : 'Waiting...'}
                      </span>
                    </div>
                  );
                })}
              </div>
              
              {getSortedTeams().every(team => team.answers?.final?.confidence !== undefined) && (
                <button className="continue-button" onClick={revealFinalQuestion}>
                  REVEAL FINAL QUESTION
                </button>
              )}
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
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">FINAL ANSWERS</div>
              <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '10px', marginBottom: '10px' }}>
                <strong style={{ color: '#286586' }}>Final Question:</strong> {finalQuestion.question}
              </div>
              <div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                <strong style={{ color: '#286586' }}>Correct answer:</strong> {finalQuestion.answer}
              </div>

              {getSortedTeams().map(team => {
                const answer = team.answers?.final;
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div className="team-name-large">{team.name} | {team.score} pts</div>
                      {answer && answer.text && !answer.marked && (
  <div className="answer-buttons">
    <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
    <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
  </div>
)}
                    </div>
                        {answer && answer.text ? (
  <div className="answer-details">
    Their answer: "{answer.text}"<br/>
    Wager: {answer.confidence} pts
    {answer.marked && (
      <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
        {answer.correct ? `✓ CORRECT (+${answer.confidence} pts)` : `✗ INCORRECT (-${answer.confidence} pts)`}
      </div>
    )}
  </div>
) : answer ? (
  <div style={{ color: '#999', fontStyle: 'italic' }}>
    Wager submitted: {answer.confidence} pts. Waiting for answer...
  </div>
) : (
  <div style={{ color: '#999', fontStyle: 'italic' }}>Waiting for wager and answer...</div>
)}
                  </div>
                );
              })}

              {getSortedTeams().every(team => team.answers?.final?.marked) && (
                <button className="continue-button" onClick={endGame}>
                  END GAME & VIEW FINAL LEADERBOARD
                </button>
              )}
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
          <div style={{ maxWidth: '1200px', margin: '60px auto', padding: '40px' }}>
            <div className="section-title" style={{ marginBottom: '40px' }}>FINAL LEADERBOARD</div>
            {getSortedTeams().map((team, idx) => (
              <div key={team.name} className="leaderboard-item" style={{
                background: idx === 0 
                  ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' 
                  : idx === 1 
                  ? 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)' 
                  : idx === 2 
                  ? 'linear-gradient(135deg, #CD7F32 0%, #B87333 100%)'
                  : 'linear-gradient(135deg, #E0E0E0 0%, #BDBDBD 100%)'
              }}>
                <div className="leaderboard-rank">#{idx + 1}</div>
                <div className="leaderboard-name">{team.name}</div>
                <div className="leaderboard-score">{team.score} pts</div>
              </div>
            ))}
            <button className="submit-button" onClick={pushFinalRankings} style={{ marginTop: '30px' }}>
              PUSH FINAL RANKINGS TO TEAMS
            </button>
          </div>
        </>
      )}

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
                <strong>Current Score:</strong> {game.teams[selectedTeamHistory.teamName]?.score} points
              </div>
            </div>

            {Object.entries(game.teams[selectedTeamHistory.teamName]?.answers || {}).map(([questionKey, answer]) => {
              const questionNum = questionKey === 'final' ? 'Final' : questionKey.replace('q', '');
              const question = questionKey === 'final' 
                ? finalQuestion 
                : questions[parseInt(questionNum) - 1];
              const isVisual = question?.type === 'visual' || Array.isArray(answer.text);
              
              return (
                <div key={questionKey} style={{
                  background: isVisual ? '#FFF9E6' : (answer.correct ? '#E8F5E9' : '#FFEBEE'),
                  border: `2px solid ${isVisual ? '#FFB300' : (answer.correct ? '#4CAF50' : '#F44336')}`,
                  borderRadius: '10px',
                  padding: '20px',
                  marginBottom: '15px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#286586', marginBottom: '5px' }}>
                        Question {questionNum} {isVisual && '📸 Visual Round'}
                      </div>
                      <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                        {/* FIXED: Changed from .question to .text */}
                        {question?.text || question?.question || 'Question text not available'}
                      </div>
                    </div>
                    {!isVisual && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '14px', color: '#666' }}>Confidence</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF6600' }}>
                          {answer.confidence}
                        </div>
                      </div>
                    )}
                  </div>

                  {isVisual ? (
                    <div>
                      {Array.isArray(answer.text) && answer.text.map((ans, idx) => {
                        const isCorrect = Array.isArray(answer.correct) ? answer.correct[idx] : false;
                        return (
                          <div key={idx} style={{
                            background: isCorrect ? '#E8F5E9' : '#FFEBEE',
                            border: `2px solid ${isCorrect ? '#4CAF50' : '#F44336'}`,
                            borderRadius: '8px',
                            padding: '15px',
                            marginBottom: '10px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#286586', marginBottom: '5px' }}>
                                #{idx + 1}
                              </div>
                              <div style={{ fontSize: '16px' }}>{ans}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              <div style={{
                                fontSize: '16px',
                                fontWeight: 'bold',
                                color: isCorrect ? '#2E7D32' : '#C62828'
                              }}>
                                {isCorrect ? '✓ CORRECT' : '✗ INCORRECT'}
                              </div>
                              <button
                                onClick={() => {
                                  const newCorrect = [...(answer.correct || [false, false, false, false, false, false])];
                                  newCorrect[idx] = !newCorrect[idx];
                                  
                                  const oldCorrectCount = (answer.correct || []).filter(Boolean).length;
                                  const newCorrectCount = newCorrect.filter(Boolean).length;
                                  const scoreDiff = newCorrectCount - oldCorrectCount;
                                  
                                  setGame(prev => ({
                                    ...prev,
                                    teams: {
                                      ...prev.teams,
                                      [selectedTeamHistory.teamName]: {
                                        ...prev.teams[selectedTeamHistory.teamName],
                                        score: prev.teams[selectedTeamHistory.teamName].score + scoreDiff,
                                        answers: {
                                          ...prev.teams[selectedTeamHistory.teamName].answers,
                                          [questionKey]: {
                                            ...answer,
                                            correct: newCorrect
                                          }
                                        }
                                      }
                                    }
                                  }));
                                  
                                  socket.emit('host:toggleCorrectness', { 
                                    gameCode, 
                                    teamName: selectedTeamHistory.teamName, 
                                    questionKey,
                                    visualIndex: idx
                                  });
                                }}
                                style={{
                                  background: isCorrect ? '#F44336' : '#4CAF50',
                                  color: 'white',
                                  border: 'none',
                                  padding: '8px 16px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Mark as {isCorrect ? 'Incorrect' : 'Correct'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ marginTop: '15px', padding: '10px', background: '#E3F2FD', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', color: '#286586' }}>
                        Score: {Array.isArray(answer.correct) ? answer.correct.filter(Boolean).length : 0} / 6 points
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}